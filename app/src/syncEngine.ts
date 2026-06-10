import AsyncStorage from '@react-native-async-storage/async-storage';
import { hlcReceive, hlcTick } from '@alcovia/shared';
import { applyEvent, emptyState } from '@alcovia/shared';
import { SEED_STUDENT_ID } from '@alcovia/shared';
import type { AppEvent, EventBody, SyncRequest, SyncResponse, SyncState } from '@alcovia/shared';
import { DEVICE_ID, SERVER_URL, STORAGE_PREFIX, SYNC_INTERVAL_MS } from './config';

/**
 * Shown when an automatic merge wasn't obviously right — i.e. a remote write
 * beat a conflicting write made on THIS device. The merge itself is already
 * settled (same outcome on every replica); this just tells the student.
 */
export interface ConflictNotice {
  id: number;
  atMs: number;
  message: string;
}

export interface EngineSnapshot {
  state: SyncState;
  online: boolean;
  outboxSize: number;
  cursor: number;
  lastSyncAtMs: number | null;
  lastSyncError: string | null;
  syncing: boolean;
  notices: ConflictNotice[];
}

interface PersistedEngine {
  state: SyncState;
  outbox: AppEvent[];
  cursor: number;
  hlc: string | null;
}

const STORE_KEY = STORAGE_PREFIX + 'engine';

/**
 * Offline-first sync engine.
 *
 * Every user action becomes an event that is applied to local state and
 * appended to a durable outbox *synchronously from the user's point of view* —
 * the network is never on the critical path. A background loop pushes the
 * outbox and pulls everything new from the server; both directions are
 * idempotent (dedupe by eventId in the shared reducer / on the server), so
 * crashes, retries and replays are safe at any point.
 */
export class SyncEngine {
  private state: SyncState = emptyState();
  private outbox: AppEvent[] = [];
  private cursor = 0;
  private hlc: string | null = null;
  private eventSeq = 0;

  online = true;
  private lastSyncAtMs: number | null = null;
  private lastSyncError: string | null = null;
  private syncing = false;
  private notices: ConflictNotice[] = [];
  private noticeSeq = 0;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private snapshot: EngineSnapshot | null = null;

  async load(): Promise<void> {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (raw) {
      const saved: PersistedEngine = JSON.parse(raw);
      this.state = saved.state;
      this.outbox = saved.outbox;
      this.cursor = saved.cursor;
      this.hlc = saved.hlc;
      this.eventSeq = Object.keys(saved.state.appliedEventIds).length + saved.outbox.length;
    }
    this.timer = setInterval(() => void this.sync(), SYNC_INTERVAL_MS);
    this.bump();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async persist(): Promise<void> {
    const saved: PersistedEngine = {
      state: this.state,
      outbox: this.outbox,
      cursor: this.cursor,
      hlc: this.hlc,
    };
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(saved));
  }

  /** Record a user action: instant local apply + durable outbox append. */
  emit(body: EventBody): void {
    this.hlc = hlcTick(this.hlc, DEVICE_ID, Date.now());
    const ev: AppEvent = {
      ...body,
      eventId: `${DEVICE_ID}-${Date.now()}-${++this.eventSeq}`,
      studentId: SEED_STUDENT_ID,
      deviceId: DEVICE_ID,
      hlc: this.hlc,
    };
    applyEvent(this.state, ev);
    this.outbox.push(ev);
    void this.persist();
    this.bump();
    if (this.online) void this.sync();
  }

  setOnline(online: boolean) {
    this.online = online;
    this.bump();
    if (online) void this.sync();
  }

  async sync(): Promise<void> {
    if (!this.online || this.syncing) return;
    this.syncing = true;
    this.bump();
    // Snapshot the outbox: events emitted while the request is in flight must
    // survive for the next round.
    const sending = [...this.outbox];
    try {
      const body: SyncRequest = {
        studentId: SEED_STUDENT_ID,
        deviceId: DEVICE_ID,
        cursor: this.cursor,
        events: sending,
      };
      const res = await fetch(`${SERVER_URL}/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SyncResponse = await res.json();

      const sentIds = new Set(sending.map((e) => e.eventId));
      this.outbox = this.outbox.filter((e) => !sentIds.has(e.eventId));
      for (const ev of data.events) {
        this.hlc = hlcReceive(this.hlc, ev.hlc, DEVICE_ID, Date.now());
        this.detectConflict(ev);
        applyEvent(this.state, ev);
      }
      this.cursor = data.cursor;
      this.lastSyncAtMs = Date.now();
      this.lastSyncError = null;
      await this.persist();
    } catch (err) {
      this.lastSyncError = (err as Error).message;
    } finally {
      this.syncing = false;
      this.bump();
    }
  }

  /**
   * Before folding a pulled event in, check whether it overrides a conflicting
   * write that was made on this device — that's the case where an automatic
   * merge "isn't obviously right" and the student deserves a heads-up.
   */
  private detectConflict(ev: AppEvent): void {
    if (ev.deviceId === DEVICE_ID || this.state.appliedEventIds[ev.eventId]) return;
    if (ev.type !== 'task_status_changed' && ev.type !== 'task_deleted') return;
    const current = this.state.tasks[ev.taskId];
    const ours = current && !current.deleted && current.statusHlc.endsWith(`:${DEVICE_ID}`);
    if (!ours) return;

    const who = ev.deviceId === 'server' ? 'the server' : ev.deviceId.replace('device-', 'device ');
    let message: string | null = null;
    if (ev.type === 'task_deleted') {
      // Tombstone wins no matter the HLC, so any local edit is overridden.
      message = `A task you set to "${current.status.replace('_', ' ')}" was deleted on ${who}.`;
    } else if (ev.hlc > current.statusHlc && ev.status !== current.status) {
      message = `Both devices edited the same task: kept ${who}'s "${ev.status.replace('_', ' ')}" over your "${current.status.replace('_', ' ')}" (newer edit wins).`;
    }
    if (message) {
      this.notices = [...this.notices.slice(-19), { id: ++this.noticeSeq, atMs: Date.now(), message }];
    }
  }

  dismissNotices() {
    this.notices = [];
    this.bump();
  }

  /** Wipe this client's local replica (dev panel helper for demos). */
  async resetLocal(): Promise<void> {
    await AsyncStorage.removeItem(STORE_KEY);
    this.state = emptyState();
    this.outbox = [];
    this.cursor = 0;
    this.hlc = null;
    this.bump();
  }

  // ---- subscription plumbing (for React's useSyncExternalStore) ----

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): EngineSnapshot => {
    if (!this.snapshot) {
      this.snapshot = {
        state: this.state,
        online: this.online,
        outboxSize: this.outbox.length,
        cursor: this.cursor,
        lastSyncAtMs: this.lastSyncAtMs,
        lastSyncError: this.lastSyncError,
        syncing: this.syncing,
        notices: this.notices,
      };
    }
    return this.snapshot;
  };

  private bump() {
    this.snapshot = null;
    for (const fn of this.listeners) fn();
  }
}

export const engine = new SyncEngine();
