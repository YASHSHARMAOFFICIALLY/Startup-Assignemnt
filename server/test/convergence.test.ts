import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { hlcTick, hlcReceive } from '../../shared/src/hlc';
import { applyEvents, emptyState } from '../../shared/src/reducer';
import { deriveRewards } from '../../shared/src/derive';
import { SEED_SUBJECTS } from '../../shared/src/seed';
import type { AppEvent, EventBody, SyncState, TaskStatus } from '../../shared/src/types';
import { Store } from '../src/store';

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_TASK_IDS = SEED_SUBJECTS.flatMap((s) => s.chapters.flatMap((c) => c.tasks.map((t) => t.taskId)));
const STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'done'];

/** Minimal model of the app's sync engine: event log + outbox + cursor. */
class SimDevice {
  state: SyncState = emptyState();
  outbox: AppEvent[] = [];
  cursor = 0;
  hlc: string | null = null;
  private seq = 0;

  constructor(public deviceId: string, private rand: () => number, private wall: () => number) {}

  private emit(body: EventBody) {
    this.hlc = hlcTick(this.hlc, this.deviceId, this.wall());
    const ev = {
      ...body,
      eventId: `${this.deviceId}-${++this.seq}`,
      studentId: 'student-1',
      deviceId: this.deviceId,
      hlc: this.hlc,
    } as AppEvent;
    this.outbox.push(ev);
    applyEvents(this.state, [ev]);
  }

  randomOfflineAction() {
    const roll = this.rand();
    if (roll < 0.35) {
      const sessionId = `${this.deviceId}-sess-${this.seq}`;
      const mins = 25 + Math.floor(this.rand() * 95);
      this.emit({ type: 'session_started', sessionId, targetMinutes: mins, startedAtMs: this.wall() });
      if (this.rand() < 0.7) {
        this.emit({
          type: 'session_completed',
          sessionId,
          targetMinutes: mins,
          completedAtMs: this.wall(),
          dayKey: '2026-06-10',
        });
      } else {
        this.emit({
          type: 'session_failed',
          sessionId,
          targetMinutes: mins,
          reason: this.rand() < 0.5 ? 'give_up' : 'app_switch',
          failedAtMs: this.wall(),
        });
      }
    } else if (roll < 0.85) {
      const taskId = ALL_TASK_IDS[Math.floor(this.rand() * ALL_TASK_IDS.length)];
      this.emit({ type: 'task_status_changed', taskId, status: STATUSES[Math.floor(this.rand() * 3)] });
    } else if (roll < 0.95) {
      const taskId = ALL_TASK_IDS[Math.floor(this.rand() * ALL_TASK_IDS.length)];
      this.emit({ type: 'task_deleted', taskId });
    } else {
      this.emit({
        type: 'reminder_updated',
        reminderAtMs: this.rand() < 0.5 ? null : Math.floor(this.rand() * 1e9),
        source: 'app',
      });
    }
  }

  /** One sync round-trip, optionally replaying the push (duplicate delivery). */
  sync(store: Store, opts: { replayPush: boolean }) {
    store.ingest(this.outbox);
    if (opts.replayPush) store.ingest(this.outbox); // same message arriving twice
    this.outbox = [];
    const pulled = store.eventsAfter(this.cursor, 'student-1');
    for (const ev of pulled) this.hlc = hlcReceive(this.hlc, ev.hlc, this.deviceId, this.wall());
    applyEvents(this.state, pulled);
    this.cursor = store.lastSeq;
  }
}

function comparable(state: SyncState) {
  return { sessions: state.sessions, tasks: state.tasks, reminder: state.reminder };
}

test('fuzz: random offline edits across 3 devices always converge, rewards exactly once', () => {
  for (let run = 0; run < 30; run++) {
    const rand = mulberry32(run * 7919 + 1);
    // Device wall clocks deliberately disagree by up to ±5 minutes.
    let now = 1_700_000_000_000;
    const skews = [0, 300_000, -300_000];
    const wall = (i: number) => () => (now += Math.floor(rand() * 1000)) + skews[i];

    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fuzz-')), 'db.json');
    const store = new Store(file);
    const devices = [0, 1, 2].map((i) => new SimDevice(`dev${i}`, rand, wall(i)));

    const completedSessions = new Set<string>();
    for (let step = 0; step < 60; step++) {
      const d = devices[Math.floor(rand() * devices.length)];
      if (rand() < 0.8) {
        d.randomOfflineAction();
      } else {
        const { newlyCompleted } = { newlyCompleted: [] as string[] };
        d.sync(store, { replayPush: rand() < 0.3 });
        void newlyCompleted;
      }
    }
    // Final reconciliation: everyone syncs twice so all events propagate.
    for (const d of devices) d.sync(store, { replayPush: true });
    for (const d of devices) d.sync(store, { replayPush: false });

    const reference = comparable(devices[0].state);
    for (const d of devices.slice(1)) {
      assert.deepEqual(comparable(d.state), reference, `run ${run}: devices diverged`);
    }
    assert.deepEqual(comparable(store.state), reference, `run ${run}: server diverged`);

    // Rewards exactly once: coins must equal the sum over *distinct* completed
    // sessions, no matter how many times events were replayed.
    for (const s of Object.values(store.state.sessions)) {
      if (s.status === 'completed') completedSessions.add(s.sessionId);
    }
    const expectedCoins = [...completedSessions].reduce(
      (sum, id) => sum + store.state.sessions[id].targetMinutes,
      0,
    );
    const rewards = deriveRewards(store.state, '2026-06-10');
    assert.equal(rewards.coins, expectedCoins, `run ${run}: coins double-counted`);
    assert.equal(rewards.completedSessions, completedSessions.size);
  }
});

test('webhook trigger fires exactly once per session across replays and restarts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-'));
  const file = path.join(dir, 'db.json');
  let store = new Store(file);

  const mk = (eventId: string, sessionId: string): AppEvent => ({
    eventId,
    studentId: 'student-1',
    deviceId: 'devA',
    hlc: hlcTick(null, 'devA', 1000),
    type: 'session_completed',
    sessionId,
    targetMinutes: 25,
    completedAtMs: 0,
    dayKey: '2026-06-10',
  });

  // Same session completes, arrives from two devices with different eventIds
  // after an offline period, plus a straight replay of the first message.
  const fromA = mk('a-1', 'sess-1');
  const fromB = { ...mk('b-1', 'sess-1'), deviceId: 'devB' };

  let triggers = 0;
  for (const batch of [[fromA], [fromA], [fromB]]) {
    const { newlyCompleted } = store.ingest(batch);
    for (const id of newlyCompleted) if (store.claimNotification(id)) triggers++;
  }
  assert.equal(triggers, 1);

  // Server restart: rebuild from disk, replay everything again.
  store = new Store(file);
  const { newlyCompleted } = store.ingest([fromA, fromB]);
  for (const id of newlyCompleted) if (store.claimNotification(id)) triggers++;
  assert.equal(triggers, 1, 'restart caused a duplicate notification');
});

test('two-way loop: replayed WhatsApp reply mutates state exactly once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-'));
  let store = new Store(path.join(dir, 'db.json'));

  // n8n (or the network) delivers the same reply twice — same replyId.
  assert.equal(store.emitServerEvent({ type: 'reminder_updated', reminderAtMs: 123, source: 'whatsapp_reply' }, 'reply-1'), true);
  assert.equal(store.emitServerEvent({ type: 'reminder_updated', reminderAtMs: 456, source: 'whatsapp_reply' }, 'reply-1'), false);
  assert.equal(store.state.reminder!.reminderAtMs, 123);

  // The server event syncs to a device like any other edit.
  const dev = new SimDevice('devA', mulberry32(1), () => Date.now());
  dev.sync(store, { replayPush: false });
  assert.equal(dev.state.reminder!.reminderAtMs, 123);

  // And it survives a server restart (it's in the same durable log).
  store = new Store(path.join(dir, 'db.json'));
  assert.equal(store.state.reminder!.reminderAtMs, 123);
});
