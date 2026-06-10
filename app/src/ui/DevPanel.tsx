import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { CLIENT_NAME, DEVICE_ID, N8N_REPLY_WEBHOOK_URL, SERVER_URL } from '../config';
import { engine } from '../syncEngine';
import { Btn, Pill, Section } from './common';

interface SinkEntry {
  receivedAtMs: number;
  body: { sessionId?: string; message?: string } & Record<string, unknown>;
}

/**
 * Requirement 6 ("demonstrable"): toggle this client online/offline, force a
 * sync, inspect the device's replica, and watch the notification sink live so
 * the n8n workflow firing exactly once is visible end-to-end.
 */
export function DevPanel() {
  const snap = React.useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [sink, setSink] = useState<SinkEntry[] | null>(null);
  const [showState, setShowState] = useState(false);
  const [replyStatus, setReplyStatus] = useState<string | null>(null);

  // Two-way loop demo: pretend the student replied to the WhatsApp message.
  // The reply goes to the n8n webhook, n8n forwards it to the backend, the
  // backend emits a synced event — and BOTH devices see the result.
  const sendReply = async (action: 'done' | 'snooze_10m') => {
    try {
      const res = await fetch(N8N_REPLY_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          replyId: `${DEVICE_ID}-${Date.now()}`,
          studentId: 'student-1',
        }),
      });
      setReplyStatus(res.ok ? `reply "${action}" sent via n8n ✓` : `n8n said HTTP ${res.status}`);
    } catch {
      setReplyStatus('n8n unreachable — is it running with the workflow active?');
    }
  };

  useEffect(() => {
    const poll = async () => {
      if (!engine.online) return;
      try {
        const res = await fetch(`${SERVER_URL}/notifications`);
        setSink(await res.json());
      } catch {
        setSink(null);
      }
    };
    void poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <Section title={`Dev panel — client ${CLIENT_NAME}`}>
      <View style={styles.row}>
        <Text style={styles.label}>Online</Text>
        <Switch value={snap.online} onValueChange={(v) => engine.setOnline(v)} />
        <View style={{ width: 12 }} />
        {snap.online ? (
          <Pill label={snap.syncing ? 'syncing…' : 'connected'} tone="ok" />
        ) : (
          <Pill label="OFFLINE — changes queue locally" tone="warn" />
        )}
      </View>

      <View style={styles.statsBox}>
        <Stat k="Device" v={DEVICE_ID} />
        <Stat k="Server" v={SERVER_URL} />
        <Stat k="Outbox (pending events)" v={String(snap.outboxSize)} />
        <Stat k="Sync cursor (server seq)" v={String(snap.cursor)} />
        <Stat
          k="Last sync"
          v={snap.lastSyncAtMs ? new Date(snap.lastSyncAtMs).toLocaleTimeString() : 'never'}
        />
        {snap.lastSyncError && <Stat k="Last sync error" v={snap.lastSyncError} warn />}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Btn label="Sync now" onPress={() => void engine.sync()} disabled={!snap.online} />
        <Btn label={showState ? 'Hide local state' : 'Show local state'} kind="ghost" onPress={() => setShowState(!showState)} />
        <Btn label="Reset this client" kind="danger" onPress={() => void engine.resetLocal()} />
      </View>

      <Text style={styles.subTitle}>Two-way loop — simulate a WhatsApp reply</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Btn label="Reply: done ✅" kind="ghost" onPress={() => void sendReply('done')} />
        <Btn label="Reply: snooze 10 m 😴" kind="ghost" onPress={() => void sendReply('snooze_10m')} />
      </View>
      {replyStatus && <Text style={styles.muted}>{replyStatus}</Text>}

      <Text style={styles.subTitle}>
        Notification sink (via n8n) — each successful session must appear exactly once
      </Text>
      {sink === null ? (
        <Text style={styles.muted}>
          {snap.online ? 'Sink unreachable — is the server running?' : 'Offline — reconnect to see the sink.'}
        </Text>
      ) : sink.length === 0 ? (
        <Text style={styles.muted}>No notifications yet.</Text>
      ) : (
        sink
          .slice()
          .reverse()
          .map((entry, i) => (
            <View key={i} style={styles.notif}>
              <Text style={styles.notifMsg}>📲 {String(entry.body.message ?? JSON.stringify(entry.body))}</Text>
              <Text style={styles.notifMeta}>
                session {String(entry.body.sessionId ?? '?')} · {new Date(entry.receivedAtMs).toLocaleTimeString()}
              </Text>
            </View>
          ))
      )}

      {showState && (
        <Text style={styles.stateDump}>
          {JSON.stringify({ sessions: snap.state.sessions, tasks: snap.state.tasks }, null, 2)}
        </Text>
      )}
    </Section>
  );
}

function Stat({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statKey}>{k}</Text>
      <Text style={[styles.statVal, warn && { color: '#b91c1c' }]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  label: { marginRight: 8, color: '#111827', fontWeight: '600' },
  statsBox: { backgroundColor: '#f9fafb', borderRadius: 8, padding: 10, marginBottom: 10 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  statKey: { color: '#6b7280', fontSize: 12 },
  statVal: { color: '#111827', fontSize: 12, fontWeight: '600' },
  subTitle: { fontWeight: '700', color: '#111827', marginTop: 6, marginBottom: 6, fontSize: 13 },
  muted: { color: '#9ca3af', fontSize: 12 },
  notif: { backgroundColor: '#eff6ff', borderRadius: 8, padding: 8, marginBottom: 6 },
  notifMsg: { color: '#1e3a8a', fontSize: 13, fontWeight: '600' },
  notifMeta: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  stateDump: {
    fontFamily: 'monospace' as never,
    fontSize: 11,
    color: '#374151',
    backgroundColor: '#f3f4f6',
    padding: 8,
    borderRadius: 8,
    marginTop: 8,
  },
});
