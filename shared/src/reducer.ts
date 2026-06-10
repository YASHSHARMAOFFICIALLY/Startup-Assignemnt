import type { AppEvent, SessionRec, SyncState, TaskRec } from './types';

/**
 * The merge core. Both the app and the server fold events through this reducer,
 * so any two replicas that have seen the same *set* of events hold the same
 * state — regardless of arrival order or duplicates:
 *
 * - duplicate-insensitive: events are skipped if their eventId was applied;
 *   beyond that, every rule below is idempotent on its own.
 * - order-insensitive: each piece of state is either a grow-only flag
 *   (task tombstones), an id-keyed record, or a last-writer-wins register
 *   ordered by HLC (string comparison, deviceId tie-break) — all commutative.
 */

export function emptyState(): SyncState {
  return { sessions: {}, tasks: {}, appliedEventIds: {} };
}

/** LWW: does an event stamped `incoming` beat the state written at `current`? */
function wins(incoming: string, current: string | undefined): boolean {
  return current === undefined || incoming > current;
}

export function applyEvent(state: SyncState, ev: AppEvent): SyncState {
  if (state.appliedEventIds[ev.eventId]) return state;
  state.appliedEventIds[ev.eventId] = true;

  switch (ev.type) {
    case 'session_started': {
      const existing = state.sessions[ev.sessionId];
      // A terminal status always beats 'running', so a late-arriving start
      // event can never resurrect a finished session.
      if (existing) {
        existing.startedAtMs = ev.startedAtMs;
        if (existing.status === 'running' && wins(ev.hlc, existing.statusHlc)) {
          existing.statusHlc = ev.hlc;
        }
      } else {
        state.sessions[ev.sessionId] = {
          sessionId: ev.sessionId,
          status: 'running',
          targetMinutes: ev.targetMinutes,
          startedAtMs: ev.startedAtMs,
          statusHlc: ev.hlc,
        };
      }
      return state;
    }
    case 'session_completed':
    case 'session_failed': {
      const existing = state.sessions[ev.sessionId];
      const terminal: SessionRec = {
        sessionId: ev.sessionId,
        status: ev.type === 'session_completed' ? 'completed' : 'failed',
        targetMinutes: ev.targetMinutes,
        startedAtMs: existing?.startedAtMs,
        statusHlc: ev.hlc,
        reason: ev.type === 'session_failed' ? ev.reason : undefined,
        dayKey: ev.type === 'session_completed' ? ev.dayKey : undefined,
        completedAtMs: ev.type === 'session_completed' ? ev.completedAtMs : undefined,
      };
      if (!existing || existing.status === 'running' || wins(ev.hlc, existing.statusHlc)) {
        state.sessions[ev.sessionId] = terminal;
      }
      return state;
    }
    case 'task_status_changed': {
      const existing = state.tasks[ev.taskId];
      if (existing?.deleted) return state; // delete-wins: tombstones are final
      if (!existing || wins(ev.hlc, existing.statusHlc)) {
        state.tasks[ev.taskId] = {
          taskId: ev.taskId,
          status: ev.status,
          statusHlc: ev.hlc,
          deleted: false,
        };
      }
      return state;
    }
    case 'task_deleted': {
      // Tombstones must be canonical: the record depends only on the *set* of
      // delete events seen, never on what status edits happened around them.
      const existing: TaskRec | undefined = state.tasks[ev.taskId];
      const deleteHlc =
        existing?.deleted && existing.statusHlc > ev.hlc ? existing.statusHlc : ev.hlc;
      state.tasks[ev.taskId] = {
        taskId: ev.taskId,
        status: 'not_started',
        statusHlc: deleteHlc,
        deleted: true,
      };
      return state;
    }
  }
}

export function applyEvents(state: SyncState, events: AppEvent[]): SyncState {
  for (const ev of events) applyEvent(state, ev);
  return state;
}

export function buildState(events: AppEvent[]): SyncState {
  return applyEvents(emptyState(), events);
}
