import fs from 'node:fs';
import path from 'node:path';
import { hlcReceive, hlcTick } from '../../shared/src/hlc';
import { applyEvent, emptyState } from '../../shared/src/reducer';
import { SEED_STUDENT_ID } from '../../shared/src/seed';
import type { AppEvent, EventBody, SyncState } from '../../shared/src/types';

export type NotifyStatus = 'pending' | 'sent';

const SERVER_DEVICE_ID = 'server';

interface DbShape {
  events: AppEvent[];
  lastSeq: number;
  /** sessionId -> notification status. The backend half of "fire exactly once". */
  notified: Record<string, NotifyStatus>;
  /** What the mock notification sink has received (for the dev panel). */
  sinkLog: { receivedAtMs: number; body: unknown }[];
  /**
   * The server is itself a replica that can author events (two-way loop:
   * notification replies become events here), so it keeps its own HLC.
   */
  serverHlc: string | null;
}

/**
 * Durable store: an append-only event log with a global sequence number,
 * persisted to a JSON file so the server survives restarts. Derived state is
 * kept in memory and rebuilt from the log on boot — the log is the truth.
 */
export class Store {
  private db: DbShape;
  state: SyncState = emptyState();

  constructor(private file: string) {
    if (fs.existsSync(file)) {
      this.db = { serverHlc: null, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } else {
      this.db = { events: [], lastSeq: 0, notified: {}, sinkLog: [], serverHlc: null };
    }
    for (const ev of this.db.events) applyEvent(this.state, ev);
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /**
   * Idempotently append client events. Replayed events (same eventId) are
   * dropped; new ones get the next global seq. Returns sessionIds that became
   * `completed` for the first time ever — the trigger for the n8n webhook.
   */
  ingest(events: AppEvent[]): { newlyCompleted: string[] } {
    const newlyCompleted: string[] = [];
    for (const ev of events) {
      if (this.state.appliedEventIds[ev.eventId]) continue;
      this.db.serverHlc = hlcReceive(this.db.serverHlc, ev.hlc, SERVER_DEVICE_ID, Date.now());
      const wasCompleted =
        ev.type === 'session_completed' &&
        this.state.sessions[ev.sessionId]?.status === 'completed';
      const stored: AppEvent = { ...ev, seq: ++this.db.lastSeq };
      this.db.events.push(stored);
      applyEvent(this.state, stored);
      if (
        ev.type === 'session_completed' &&
        !wasCompleted &&
        this.state.sessions[ev.sessionId]?.status === 'completed'
      ) {
        newlyCompleted.push(ev.sessionId);
      }
    }
    if (newlyCompleted.length || events.length) this.persist();
    return { newlyCompleted };
  }

  /**
   * Author an event *on the server* (two-way loop). It flows through the same
   * idempotent ingest as device events — pass a stable `idempotencyKey`
   * (e.g. the WhatsApp reply id) and replays become no-ops. Returns false if
   * the event was a duplicate.
   */
  emitServerEvent(body: EventBody, idempotencyKey?: string): boolean {
    this.db.serverHlc = hlcTick(this.db.serverHlc, SERVER_DEVICE_ID, Date.now());
    const ev: AppEvent = {
      ...body,
      eventId: idempotencyKey ? `server-${idempotencyKey}` : `server-${this.db.serverHlc}`,
      studentId: SEED_STUDENT_ID,
      deviceId: SERVER_DEVICE_ID,
      hlc: this.db.serverHlc,
    };
    if (this.state.appliedEventIds[ev.eventId]) return false;
    this.ingest([ev]);
    return true;
  }

  eventsAfter(cursor: number, studentId: string): AppEvent[] {
    return this.db.events.filter((e) => e.seq! > cursor && e.studentId === studentId);
  }

  get lastSeq(): number {
    return this.db.lastSeq;
  }

  /** Claim a session for notification; false if it was already claimed. */
  claimNotification(sessionId: string): boolean {
    if (this.db.notified[sessionId]) return false;
    this.db.notified[sessionId] = 'pending';
    this.persist();
    return true;
  }

  markNotified(sessionId: string) {
    this.db.notified[sessionId] = 'sent';
    this.persist();
  }

  pendingNotifications(): string[] {
    return Object.entries(this.db.notified)
      .filter(([, status]) => status === 'pending')
      .map(([sessionId]) => sessionId);
  }

  appendSink(body: unknown) {
    this.db.sinkLog.push({ receivedAtMs: Date.now(), body });
    this.persist();
  }

  get sinkLog() {
    return this.db.sinkLog;
  }

  clearSink() {
    this.db.sinkLog = [];
    this.persist();
  }
}
