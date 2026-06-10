import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CLIENT_NAME } from './src/config';
import { focus } from './src/focus';
import { engine } from './src/syncEngine';
import { DevPanel } from './src/ui/DevPanel';
import { FocusScreen } from './src/ui/FocusScreen';
import { SyllabusScreen } from './src/ui/SyllabusScreen';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      await engine.load();
      await focus.load();
      setReady(true);
    })();
    return () => engine.stop();
  }, []);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <Text>Loading…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Alcovia Study</Text>
          <Text style={styles.subtitle}>
            Client {CLIENT_NAME} · open another tab with ?client=B for a second device
          </Text>
        </View>
        <FocusScreen />
        <SyllabusScreen />
        <DevPanel />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f3f4f6' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 14, paddingTop: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#111827' },
  subtitle: { color: '#6b7280', fontSize: 12, marginTop: 2 },
});
