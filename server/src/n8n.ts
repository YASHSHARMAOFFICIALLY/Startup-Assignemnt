import { deriveRewards, dayKeyOf } from '../../shared/src/derive';
import type { Store } from './store';

const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL ?? 'http://localhost:5678/webhook/focus-session-success';

export interface SessionWebhookPayload {
  /** Stable dedupe key — the n8n workflow keys its idempotency guard on this. */
  sessionId: string;
  studentId: string;
  targetMinutes: number;
  coinsEarned: number;
  streakDays: number;
  todayFocusMinutes: number;
}

/**
 * Fire the n8n webhook for a session confirmed as a success, at-least-once.
 * Exactly-once delivery over HTTP is impossible, so the guarantee is layered:
 * the store only lets each sessionId be *claimed* once, and n8n dedupes on
 * sessionId again, making retries here safe.
 */
export async function notifySession(store: Store, sessionId: string): Promise<void> {
  const session = store.state.sessions[sessionId];
  if (!session || session.status !== 'completed') return;

  const rewards = deriveRewards(store.state, dayKeyOf(Date.now()));
  const payload: SessionWebhookPayload = {
    sessionId,
    studentId: 'student-1',
    targetMinutes: session.targetMinutes,
    coinsEarned: session.targetMinutes,
    streakDays: rewards.streakDays,
    todayFocusMinutes: rewards.todayFocusMinutes,
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        store.markNotified(sessionId);
        console.log(`[n8n] webhook fired for session ${sessionId}`);
        return;
      }
      console.warn(`[n8n] webhook HTTP ${res.status} (attempt ${attempt})`);
    } catch (err) {
      console.warn(`[n8n] webhook failed (attempt ${attempt}):`, (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
  }
  // Still 'pending' — it will be retried on next server boot.
}
