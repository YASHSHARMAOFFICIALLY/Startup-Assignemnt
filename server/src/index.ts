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
    lastSeq: store.lastSeq,
  });
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
