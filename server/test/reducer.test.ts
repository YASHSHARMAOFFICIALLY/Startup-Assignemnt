import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hlcTick, hlcReceive } from '../../shared/src/hlc';
import { applyEvents, buildState, emptyState, applyEvent } from '../../shared/src/reducer';
import { deriveRewards } from '../../shared/src/derive';
import type { AppEvent } from '../../shared/src/types';

let n = 0;
function ev(body: Partial<AppEvent> & { type: AppEvent['type'] }, hlc: string): AppEvent {
  return {
    eventId: `e${++n}`,
    studentId: 'student-1',
    deviceId: 'test',
    hlc,
    ...body,
  } as AppEvent;
}

test('hlc: monotonic even when wall clock goes backwards', () => {
  const a = hlcTick(null, 'A', 1000);
  const b = hlcTick(a, 'A', 500); // clock jumped back
  const c = hlcTick(b, 'A', 500);
  assert.ok(b > a);
  assert.ok(c > b);
});

test('hlc: receiving a remote stamp pulls the local clock forward', () => {
  const remote = hlcTick(null, 'B', 9999999);
  const local = hlcReceive(hlcTick(null, 'A', 1000), remote, 'A', 1000);
  assert.ok(local > remote);
});

test('task conflict: higher HLC wins regardless of arrival order', () => {
  const early = ev({ type: 'task_status_changed', taskId: 't1', status: 'in_progress' }, hlcTick(null, 'A', 1000));
  const late = ev({ type: 'task_status_changed', taskId: 't1', status: 'done' }, hlcTick(null, 'B', 2000));

  const s1 = buildState([early, late]);
  const s2 = buildState([late, early]);
  assert.equal(s1.tasks['t1'].status, 'done');
  assert.deepEqual(s1.tasks, s2.tasks);
});

test('edit vs delete: delete wins even if the edit has a later HLC', () => {
  const del = ev({ type: 'task_deleted', taskId: 't1' }, hlcTick(null, 'A', 1000));
  const edit = ev({ type: 'task_status_changed', taskId: 't1', status: 'done' }, hlcTick(null, 'B', 5000));

  for (const order of [[del, edit], [edit, del]]) {
    const s = buildState(order);
    assert.equal(s.tasks['t1'].deleted, true);
  }
});

test('duplicate events are no-ops', () => {
  const e = ev(
    { type: 'session_completed', sessionId: 's1', targetMinutes: 25, completedAtMs: 0, dayKey: '2026-06-10' },
    hlcTick(null, 'A', 1000),
  );
  const s = applyEvents(emptyState(), [e, e, { ...e }]);
  assert.equal(deriveRewards(s, '2026-06-10').coins, 25);
  assert.equal(deriveRewards(s, '2026-06-10').completedSessions, 1);
});

test('late session_started cannot resurrect a finished session', () => {
  const done = ev(
    { type: 'session_completed', sessionId: 's1', targetMinutes: 30, completedAtMs: 0, dayKey: '2026-06-10' },
    hlcTick(null, 'A', 2000),
  );
  const start = ev(
    { type: 'session_started', sessionId: 's1', targetMinutes: 30, startedAtMs: 0 },
    hlcTick(null, 'A', 1000),
  );
  const s = buildState([done, start]);
  assert.equal(s.sessions['s1'].status, 'completed');
});

test('streak: consecutive days, today missing does not break it', () => {
  const s = emptyState();
  let clock: string | null = null;
  for (const [i, day] of ['2026-06-07', '2026-06-08', '2026-06-09'].entries()) {
    clock = hlcTick(clock, 'A', 1000 + i);
    applyEvent(
      s,
      ev({ type: 'session_completed', sessionId: `d${i}`, targetMinutes: 25, completedAtMs: 0, dayKey: day }, clock),
    );
  }
  assert.equal(deriveRewards(s, '2026-06-10').streakDays, 3); // today has none yet
  assert.equal(deriveRewards(s, '2026-06-09').streakDays, 3);
  assert.equal(deriveRewards(s, '2026-06-12').streakDays, 0); // gap broke it
});
