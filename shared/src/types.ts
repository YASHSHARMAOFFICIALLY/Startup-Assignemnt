export type TaskStatus = 'not_started' | 'in_progress' | 'done';
export type FailReason = 'give_up' | 'app_switch';

/**
 * Every mutation in the system is an immutable event. Events are flattened
 * discriminated unions so they serialize cleanly over the sync protocol.
 */
export type EventBody =
  | {
      type: 'session_started';
      sessionId: string;
      targetMinutes: number;
      startedAtMs: number;
    }
  | {
      type: 'session_completed';
      sessionId: string;
      targetMinutes: number;
      completedAtMs: number;
      /** Local calendar day on the device that completed it, YYYY-MM-DD. */
      dayKey: string;
    }
  | {
      type: 'session_failed';
      sessionId: string;
      targetMinutes: number;
      reason: FailReason;
      failedAtMs: number;
    }
  | { type: 'task_status_changed'; taskId: string; status: TaskStatus }
  | { type: 'task_deleted'; taskId: string }
  | {
      /**
       * Two-way loop: a WhatsApp/notification reply ("done" / "snooze 10m")
       * comes back through n8n and the backend turns it into a normal event,
       * so it reconciles across devices like any other edit.
       */
      type: 'reminder_updated';
      reminderAtMs: number | null;
      source: 'whatsapp_reply' | 'app';
    };

export type AppEvent = EventBody & {
  /** Globally unique, generated on the device. The idempotency key everywhere. */
  eventId: string;
  studentId: string;
  deviceId: string;
  /** Hybrid logical clock at the moment the event was created. */
  hlc: string;
  /** Global order assigned by the server; absent while the event is local-only. */
  seq?: number;
};

export interface SessionRec {
  sessionId: string;
  status: 'running' | 'completed' | 'failed';
  targetMinutes: number;
  startedAtMs?: number;
  /** HLC of the event that decided the current status (for LWW). */
  statusHlc: string;
  reason?: FailReason;
  dayKey?: string;
  completedAtMs?: number;
}

export interface TaskRec {
  taskId: string;
  status: TaskStatus;
  statusHlc: string;
  deleted: boolean;
}

export interface ReminderRec {
  reminderAtMs: number | null;
  source: 'whatsapp_reply' | 'app';
  statusHlc: string;
}

export interface SyncState {
  sessions: Record<string, SessionRec>;
  tasks: Record<string, TaskRec>;
  /** LWW register driven by the two-way notification loop (and the app). */
  reminder: ReminderRec | null;
  /** Events already folded in — makes applying a replayed event a no-op. */
  appliedEventIds: Record<string, true>;
}

export interface SyncRequest {
  studentId: string;
  deviceId: string;
  /** Server seq the client has already seen; server returns everything after it. */
  cursor: number;
  events: AppEvent[];
}

export interface SyncResponse {
  events: AppEvent[];
  cursor: number;
}
