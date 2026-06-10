import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { dayKeyOf } from '@alcovia/shared';
import type { FailReason } from '@alcovia/shared';
import { BACKGROUND_GRACE_MS, DEVICE_ID, STORAGE_PREFIX } from './config';
import { engine } from './syncEngine';

export interface ActiveSession {
  sessionId: string;
  targetMinutes: number;
  startedAtMs: number;
}

const ACTIVE_KEY = STORAGE_PREFIX + 'activeSession';

/**
 * Runs the focus timer on this device. The active session is persisted
 * separately from synced state so that a crash/restart mid-session is
 * detectable: if the app boots and finds a leftover active session, the
 * student left the app — that attempt is failed as `app_switch` (deliberate
 * rule, see README).
 */
class FocusController {
  active: ActiveSession | null = null;
  private hiddenAtMs: number | null = null;
  private listeners = new Set<() => void>();

  async load(): Promise<void> {
    const raw = await AsyncStorage.getItem(ACTIVE_KEY);
    if (raw) {
      const stale: ActiveSession = JSON.parse(raw);
      this.fail(stale, 'app_switch');
    }
    AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        if (
          this.active &&
          this.hiddenAtMs !== null &&
          Date.now() - this.hiddenAtMs > BACKGROUND_GRACE_MS
        ) {
          this.fail(this.active, 'app_switch');
        }
        this.hiddenAtMs = null;
      } else {
        this.hiddenAtMs = Date.now();
      }
      this.bump();
    });
  }

  start(targetMinutes: number) {
    if (this.active) return;
    this.active = {
      sessionId: `${DEVICE_ID}-${Date.now()}`,
      targetMinutes,
      startedAtMs: Date.now(),
    };
    void AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(this.active));
    engine.emit({
      type: 'session_started',
      sessionId: this.active.sessionId,
      targetMinutes,
      startedAtMs: this.active.startedAtMs,
    });
    this.bump();
  }

  /** Called by the UI ticker; resolves the session when the target elapses. */
  tick() {
    if (!this.active || this.hiddenAtMs !== null) return;
    const elapsed = Date.now() - this.active.startedAtMs;
    if (elapsed >= this.active.targetMinutes * 60_000) {
      const done = this.active;
      this.clearActive();
      engine.emit({
        type: 'session_completed',
        sessionId: done.sessionId,
        targetMinutes: done.targetMinutes,
        completedAtMs: Date.now(),
        dayKey: dayKeyOf(Date.now()),
      });
    }
  }

  giveUp() {
    if (this.active) this.fail(this.active, 'give_up');
  }

  /** Dev-panel helper: pretend the student switched apps past the grace period. */
  simulateAppSwitch() {
    if (this.active) this.fail(this.active, 'app_switch');
  }

  private fail(session: ActiveSession, reason: FailReason) {
    this.clearActive();
    engine.emit({
      type: 'session_failed',
      sessionId: session.sessionId,
      targetMinutes: session.targetMinutes,
      reason,
      failedAtMs: Date.now(),
    });
  }

  private clearActive() {
    this.active = null;
    void AsyncStorage.removeItem(ACTIVE_KEY);
    this.bump();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private bump() {
    for (const fn of this.listeners) fn();
  }
}

export const focus = new FocusController();
