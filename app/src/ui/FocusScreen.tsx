import React, { useEffect, useReducer } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { deriveRewards, dayKeyOf } from '@alcovia/shared';
import { focus } from '../focus';
import { engine } from '../syncEngine';
import { Btn, Pill, Section } from './common';

const CHOICES = [
  { label: '25 min', minutes: 25 },
  { label: '50 min', minutes: 50 },
  { label: '90 min', minutes: 90 },
  { label: 'Demo: 10 s', minutes: 10 / 60 },
];

function fmt(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function FocusScreen() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const snap = React.useSyncExternalStore(engine.subscribe, engine.getSnapshot);

  useEffect(() => focus.subscribe(force), []);
  useEffect(() => {
    const t = setInterval(() => {
      focus.tick();
      if (focus.active) force();
    }, 250);
    return () => clearInterval(t);
  }, []);

  const rewards = deriveRewards(snap.state, dayKeyOf(Date.now()));
  const active = focus.active;
  const recent = Object.values(snap.state.sessions)
    .filter((s) => s.status !== 'running')
    .sort((a, b) => b.statusHlc.localeCompare(a.statusHlc))
    .slice(0, 5);

  return (
    <Section title="Focus session">
      <View style={styles.rewardsRow}>
        <Pill label={`🔥 Streak ${rewards.streakDays}d`} tone="ok" />
        <Pill label={`🪙 ${rewards.coins} coins`} tone="ok" />
        <Pill label={`⏱ Today ${Math.round(rewards.todayFocusMinutes)} min`} tone="muted" />
      </View>

      {active ? (
        <View style={styles.timerBox}>
          <Text style={styles.timer}>
            {fmt(active.targetMinutes * 60_000 - (Date.now() - active.startedAtMs))}
          </Text>
          <Text style={styles.timerSub}>
            Stay here! Leaving for &gt;5 s fails the session.
          </Text>
          <View style={styles.row}>
            <Btn label="Give up" kind="danger" onPress={() => focus.giveUp()} />
            <Btn label="Simulate app switch" kind="ghost" onPress={() => focus.simulateAppSwitch()} />
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          {CHOICES.map((c) => (
            <Btn key={c.label} label={c.label} onPress={() => focus.start(c.minutes)} />
          ))}
        </View>
      )}

      {recent.length > 0 && (
        <View style={{ marginTop: 8 }}>
          {recent.map((s) => (
            <Text key={s.sessionId} style={styles.historyLine}>
              {s.status === 'completed' ? '✅' : '❌'}{' '}
              {Math.round(s.targetMinutes * 10) / 10} min
              {s.status === 'failed' ? ` (${s.reason})` : ` · +${Math.max(1, Math.round(s.targetMinutes))} coins`}
              {'  '}
              <Text style={styles.historyDevice}>{s.sessionId.split('-').slice(0, 2).join('-')}</Text>
            </Text>
          ))}
        </View>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  rewardsRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  timerBox: { alignItems: 'center', paddingVertical: 8 },
  timer: { fontSize: 44, fontWeight: '800', color: '#111827', fontVariant: ['tabular-nums'] },
  timerSub: { color: '#6b7280', marginBottom: 10, fontSize: 12 },
  historyLine: { color: '#374151', fontSize: 13, marginBottom: 2 },
  historyDevice: { color: '#9ca3af', fontSize: 11 },
});
