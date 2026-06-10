import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { deriveRewards, dayKeyOf } from '../../shared/src/derive';
import type { SyncRequest, SyncResponse } from '../../shared/src/types';
import { notifySession } from './n8n';
import { Store } from './store';

const PORT = Number(process.env.PORT ?? 4000);
const DB_FILE = process.env.DB_FILE ?? path.resolve(import.meta.dirname, '../data/db.json');

const store = new Store(DB_FILE);
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

/**
 * The whole sync protocol is this one endpoint. The client pushes its outbox
 * (deduped by eventId, so retries and double-sends are harmless) and pulls
 * everything it hasn't seen yet via its cursor.
 */
app.post('/sync', (req, res) => {
  const body = req.body as SyncRequest;
  if (!body || typeof body.cursor !== 'number' || !Array.isArray(body.events)) {
    return res.status(400).json({ error: 'bad sync request' });
  }
  const { newlyCompleted } = store.ingest(body.events);
  for (const sessionId of newlyCompleted) {
    if (store.claimNotification(sessionId)) {
      void notifySession(store, sessionId);
    }
  }
  const response: SyncResponse = {
    events: store.eventsAfter(body.cursor, body.studentId),
    cursor: store.lastSeq,
  };
  res.json(response);
});

app.get('/state/:studentId', (req, res) => {
  res.json({
    rewards: deriveRewards(store.state, dayKeyOf(Date.now())),
    sessions: store.state.sessions,
    tasks: store.state.tasks,
    reminder: store.state.reminder,
    lastSeq: store.lastSeq,
  });
});

/**
 * Two-way loop: n8n forwards the student's WhatsApp reply here ("done" /
 * "snooze 10m"). It becomes a server-authored event in the same log, so it
 * reconciles to every device like any other edit. `replyId` is the dedupe key:
 * the same reply delivered twice mutates state exactly once.
 */
app.post('/notification-reply', (req, res) => {
  const { action, replyId } = (req.body ?? {}) as { action?: string; replyId?: string };
  if (action !== 'done' && action !== 'snooze_10m') {
    return res.status(400).json({ error: 'action must be "done" or "snooze_10m"' });
  }
  const applied = store.emitServerEvent(
    {
      type: 'reminder_updated',
      reminderAtMs: action === 'snooze_10m' ? Date.now() + 10 * 60_000 : null,
      source: 'whatsapp_reply',
    },
    replyId,
  );
  console.log(`[reply] ${action} (replyId=${replyId ?? 'none'}) applied=${applied}`);
  res.json({ ok: true, applied });
});

/** Mock notification sink — the n8n workflow delivers here. */
app.post('/notification-sink', (req, res) => {
  store.appendSink(req.body);
  console.log('[sink] notification received:', JSON.stringify(req.body));
  res.json({ ok: true });
});

app.get('/notifications', (_req, res) => res.json(store.sinkLog));
app.delete('/notifications', (_req, res) => {
  store.clearSink();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  // Crash-safety: anything claimed but not delivered before a restart is
  // retried. n8n dedupes by sessionId, so a duplicate delivery is harmless.
  for (const sessionId of store.pendingNotifications()) {
    void notifySession(store, sessionId);
  }
});
