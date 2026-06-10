import fs from 'node:fs';
import path from 'node:path';
import { applyEvent, emptyState } from '../../shared/src/reducer';
import type { AppEvent, SyncState } from '../../shared/src/types';

export type NotifyStatus = 'pending' | 'sent';

interface DbShape {
  events: AppEvent[];
  lastSeq: number;
  /** sessionId -> notification status. The backend half of "fire exactly once". */
  notified: Record<string, NotifyStatus>;
  /** What the mock notification sink has received (for the dev panel). */
  sinkLog: { receivedAtMs: number; body: unknown }[];
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
      this.db = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      this.db = { events: [], lastSeq: 0, notified: {}, sinkLog: [] };
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
