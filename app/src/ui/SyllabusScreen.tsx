import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { deriveProgress, taskStatus } from '@alcovia/shared';
import { SEED_SUBJECTS } from '@alcovia/shared';
import type { TaskStatus } from '@alcovia/shared';
import { engine } from '../syncEngine';
import { Section } from './common';

const NEXT: Record<TaskStatus, TaskStatus> = {
  not_started: 'in_progress',
  in_progress: 'done',
  done: 'not_started',
};

const BADGE: Record<TaskStatus, { label: string; bg: string; fg: string }> = {
  not_started: { label: 'Not started', bg: '#f3f4f6', fg: '#374151' },
  in_progress: { label: 'In progress', bg: '#fef3c7', fg: '#92400e' },
  done: { label: 'Done ✓', bg: '#dcfce7', fg: '#166534' },
};

export function SyllabusScreen() {
  const snap = React.useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const progress = deriveProgress(snap.state);

  return (
    <Section title="Syllabus progress">
      <Text style={styles.hint}>Tap a task to advance its status · long-press to delete</Text>
      {SEED_SUBJECTS.map((subject) => {
        const sp = progress.find((p) => p.subjectId === subject.subjectId)!;
        return (
          <View key={subject.subjectId} style={styles.subject}>
            <View style={styles.subjectHeader}>
              <Text style={styles.subjectTitle}>{subject.title}</Text>
              <Text style={styles.subjectPct}>{sp.percent}%</Text>
            </View>
            <ProgressBar percent={sp.percent} />
            {subject.chapters.map((ch) => {
              const cp = sp.chapters.find((c) => c.chapterId === ch.chapterId)!;
              return (
                <View key={ch.chapterId} style={styles.chapter}>
                  <Text style={styles.chapterTitle}>
                    {ch.title} · {cp.doneTasks}/{cp.totalTasks} ({cp.percent}%)
                  </Text>
                  {ch.tasks.map((task) => {
                    const status = taskStatus(snap.state, task.taskId);
                    if (status === 'deleted') {
                      return (
                        <Text key={task.taskId} style={styles.deleted}>
                          🗑 {task.title} (deleted)
                        </Text>
                      );
                    }
                    const badge = BADGE[status];
                    return (
                      <Pressable
                        key={task.taskId}
                        onPress={() =>
                          engine.emit({
                            type: 'task_status_changed',
                            taskId: task.taskId,
                            status: NEXT[status],
                          })
                        }
                        onLongPress={() =>
                          engine.emit({ type: 'task_deleted', taskId: task.taskId })
                        }
                        style={({ pressed }) => [styles.task, pressed && { opacity: 0.6 }]}
                      >
                        <Text style={styles.taskTitle}>{task.title}</Text>
                        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                          <Text style={{ color: badge.fg, fontSize: 11, fontWeight: '600' }}>
                            {badge.label}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </View>
        );
      })}
    </Section>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <View style={styles.barOuter}>
      <View style={[styles.barInner, { width: `${percent}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: '#6b7280', fontSize: 12, marginBottom: 8 },
  subject: { marginBottom: 14 },
  subjectHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  subjectTitle: { fontWeight: '700', fontSize: 15, color: '#111827' },
  subjectPct: { fontWeight: '700', color: '#1d4ed8' },
  barOuter: { height: 8, backgroundColor: '#e5e7eb', borderRadius: 4, marginBottom: 8 },
  barInner: { height: 8, backgroundColor: '#1d4ed8', borderRadius: 4 },
  chapter: { marginLeft: 4, marginBottom: 6 },
  chapterTitle: { fontWeight: '600', color: '#374151', fontSize: 13, marginBottom: 4 },
  task: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#f9fafb',
    borderRadius: 6,
    marginBottom: 4,
  },
  taskTitle: { color: '#111827', fontSize: 13, flexShrink: 1, marginRight: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  deleted: { color: '#9ca3af', fontSize: 13, textDecorationLine: 'line-through', marginBottom: 4, paddingHorizontal: 8 },
});
