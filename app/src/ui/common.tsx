import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function Btn({
  label,
  onPress,
  kind = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        styles[kind],
        disabled && styles.disabled,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.btnText, kind === 'ghost' && { color: '#1d4ed8' }]}>{label}</Text>
    </Pressable>
  );
}

export function Pill({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'muted' }) {
  const colors = { ok: '#dcfce7', warn: '#fee2e2', muted: '#e5e7eb' } as const;
  const text = { ok: '#166534', warn: '#991b1b', muted: '#374151' } as const;
  return (
    <View style={[styles.pill, { backgroundColor: colors[tone] }]}>
      <Text style={{ color: text[tone], fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10, color: '#111827' },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 8,
    marginBottom: 8,
  },
  primary: { backgroundColor: '#1d4ed8' },
  danger: { backgroundColor: '#dc2626' },
  ghost: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe' },
  disabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginRight: 6,
    marginBottom: 4,
  },
});
