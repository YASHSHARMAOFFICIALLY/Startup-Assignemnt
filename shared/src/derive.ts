import type { SessionRec, SyncState, TaskStatus } from './types';
import { SEED_SUBJECTS } from './seed';

/**
 * Rewards are never stored — they are derived from the set of *completed*
 * sessions. Sessions live in an id-keyed map, so a session replayed during
 * sync, or arriving from both devices, collapses into one record and can only
 * ever count once. This is what makes rewards idempotent by construction.
 */

export function coinsForSession(s: SessionRec): number {
  return s.targetMinutes; // 1 coin per focused minute, e.g. 50-min session = +50
}

export function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function shiftDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return dayKeyOf(date.getTime());
}

export interface Rewards {
  coins: number;
  streakDays: number;
  todayFocusMinutes: number;
  completedSessions: number;
}

export function deriveRewards(state: SyncState, todayKey: string): Rewards {
  const completed = Object.values(state.sessions).filter((s) => s.status === 'completed');
  const days = new Set(completed.map((s) => s.dayKey!));

  // Streak: consecutive days with >= 1 successful session, counting back from
  // today (or from yesterday if today has none yet — today doesn't break it).
  let streakDays = 0;
  let cursor = days.has(todayKey) ? todayKey : shiftDayKey(todayKey, -1);
  while (days.has(cursor)) {
    streakDays += 1;
    cursor = shiftDayKey(cursor, -1);
  }

  return {
    coins: completed.reduce((sum, s) => sum + coinsForSession(s), 0),
    streakDays,
    todayFocusMinutes: completed
      .filter((s) => s.dayKey === todayKey)
      .reduce((sum, s) => sum + s.targetMinutes, 0),
    completedSessions: completed.length,
  };
}

/** Effective status of a seeded task, folding in synced overrides. */
export function taskStatus(state: SyncState, taskId: string): TaskStatus | 'deleted' {
  const rec = state.tasks[taskId];
  if (!rec) return 'not_started';
  return rec.deleted ? 'deleted' : rec.status;
}

export interface ChapterProgress {
  chapterId: string;
  title: string;
  doneTasks: number;
  totalTasks: number;
  percent: number;
}

export interface SubjectProgress {
  subjectId: string;
  title: string;
  percent: number;
  chapters: ChapterProgress[];
}

export function deriveProgress(state: SyncState): SubjectProgress[] {
  return SEED_SUBJECTS.map((subject) => {
    const chapters = subject.chapters.map((ch) => {
      const live = ch.tasks.filter((t) => taskStatus(state, t.taskId) !== 'deleted');
      const done = live.filter((t) => taskStatus(state, t.taskId) === 'done').length;
      return {
        chapterId: ch.chapterId,
        title: ch.title,
        doneTasks: done,
        totalTasks: live.length,
        percent: live.length === 0 ? 0 : Math.round((done / live.length) * 100),
      };
    });
    const totals = chapters.reduce(
      (acc, c) => ({ done: acc.done + c.doneTasks, total: acc.total + c.totalTasks }),
      { done: 0, total: 0 },
    );
    return {
      subjectId: subject.subjectId,
      title: subject.title,
      percent: totals.total === 0 ? 0 : Math.round((totals.done / totals.total) * 100),
      chapters,
    };
  });
}
