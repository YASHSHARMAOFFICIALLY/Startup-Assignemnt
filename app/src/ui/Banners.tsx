import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { engine } from '../syncEngine';
import { Btn } from './common';

/**
 * Reminder set via the two-way loop (WhatsApp reply → n8n → backend event) —
 * because it's ordinary synced state, it shows up on every device.
 */
export function ReminderBanner() {
  const snap = React.useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const reminder = snap.state.reminder;
  if (!reminder || reminder.reminderAtMs === null) return null;

  const due = reminder.reminderAtMs <= Date.now();
  return (
    <View style={[styles.banner, styles.reminder]}>
      <Text style={styles.reminderText}>
        {due
          ? '⏰ Snoozed reminder is due — time to focus!'
          : `⏰ Focus reminder snoozed until ${new Date(reminder.reminderAtMs).toLocaleTimeString()}`}
        {reminder.source === 'whatsapp_reply' ? ' (set via WhatsApp reply)' : ''}
      </Text>
      <Btn
        label="Dismiss"
        kind="ghost"
        onPress={() => engine.emit({ type: 'reminder_updated', reminderAtMs: null, source: 'app' })}
      />
    </View>
  );
}

/** Conflicts that auto-merged against this device's own edits. */
export function ConflictBanner() {
  const snap = React.useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  if (snap.notices.length === 0) return null;

  return (
    <View style={[styles.banner, styles.conflict]}>
      <Text style={styles.conflictTitle}>Merged while you were offline</Text>
      {snap.notices.map((n) => (
        <Text key={n.id} style={styles.conflictText}>
          • {n.message}
        </Text>
      ))}
      <Btn label="Got it" kind="ghost" onPress={() => engine.dismissNotices()} />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 12,
    marginTop: 12,
    borderWidth: 1,
  },
  reminder: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' },
  reminderText: { color: '#1e3a8a', fontWeight: '600', marginBottom: 8, fontSize: 13 },
  conflict: { backgroundColor: '#fffbeb', borderColor: '#fde68a' },
  conflictTitle: { color: '#92400e', fontWeight: '700', marginBottom: 4, fontSize: 13 },
  conflictText: { color: '#92400e', fontSize: 12, marginBottom: 4 },
});
