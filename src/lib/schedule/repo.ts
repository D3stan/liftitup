import crypto from 'node:crypto';
import type {
  CalendarDay as DomainCalendarDay,
  RotationSchedule,
  ScheduleDay,
  ScheduleEvent,
  ScheduleEventType,
  WorkoutSession,
} from '@/types/domain';
import { query, withTransaction } from '@/lib/db/connection';
import {
  getActiveSchedule,
  listScheduleEvents,
  listWorkoutSessions,
} from '@/lib/db/workouts';
import {
  projectCalendar,
  type QueueDay,
  type QueueEvent,
  type QueueSession,
} from './queue.ts';

export interface HydratedCalendarDay extends DomainCalendarDay {
  events: ScheduleEvent[];
}

export interface ProjectUserCalendarResult {
  schedule: RotationSchedule | null;
  days: HydratedCalendarDay[];
  today: string;
  rangeStart: string;
  rangeEnd: string;
}

const MS_PER_DAY = 86_400_000;

export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

export function parseIsoDateMs(value: string): number {
  if (!isValidIsoDate(value)) {
    throw new Error(`Invalid YYYY-MM-DD date: "${value}"`);
  }
  const [y, m, d] = value.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formatIsoDateMs(ms: number): string {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysIso(dateStr: string, deltaDays: number): string {
  return formatIsoDateMs(parseIsoDateMs(dateStr) + deltaDays * MS_PER_DAY);
}

export function getMondayOfWeekIso(dateStr: string): string {
  const ms = parseIsoDateMs(dateStr);
  const dow = new Date(ms).getUTCDay(); // 0=Sun .. 6=Sat
  const offsetFromMonday = dow === 0 ? -6 : 1 - dow;
  return formatIsoDateMs(ms + offsetFromMonday * MS_PER_DAY);
}

export function daysBetweenIso(startStr: string, endStr: string): number {
  return Math.round((parseIsoDateMs(endStr) - parseIsoDateMs(startStr)) / MS_PER_DAY);
}

function toQueueDays(days: readonly ScheduleDay[]): QueueDay[] {
  return days.map((d) => ({
    id: d.id,
    position: d.position,
    label: d.label,
    isRestDay: d.isRestDay,
  }));
}

function toQueueEvents(events: readonly ScheduleEvent[]): QueueEvent[] {
  return events.map((e) => ({
    id: e.id,
    eventDate: e.eventDate,
    eventType: e.eventType,
    shiftDays: e.shiftDays,
    jollyLabel: e.jollyLabel,
    createdAt: e.createdAt,
  }));
}

export function toQueueSessions(
  sessions: readonly WorkoutSession[],
): QueueSession[] {
  return sessions.map((s) => ({
    id: s.id,
    sessionDate: s.sessionDate,
    scheduleDayId: s.scheduleDayId,
    isJolly: s.isJolly,
    jollyMode: s.jollyMode,
    title: s.title,
    completedAt: s.completedAt,
    cid: s.cid,
    isImported: Boolean(s.cid?.startsWith('import:')),
  }));
}

/**
 * Projects a user's active rotation schedule across [rangeStart .. rangeEnd].
 * When the user has no active schedule, still returns any logged sessions in range.
 */
export async function projectUserCalendar(opts: {
  userId: string;
  today: string;
  rangeStart: string;
  rangeEnd: string;
}): Promise<ProjectUserCalendarResult> {
  const { userId, today, rangeStart, rangeEnd } = opts;
  const schedule = await getActiveSchedule(userId);

  if (!schedule) {
    const sessions = await listWorkoutSessions(userId, {
      from: rangeStart,
      to: rangeEnd,
      includeExercises: false,
    });
    const sessionsByDate = new Map<string, WorkoutSession[]>();
    for (const s of sessions) {
      const list = sessionsByDate.get(s.sessionDate) ?? [];
      list.push(s);
      sessionsByDate.set(s.sessionDate, list);
    }

    const days: HydratedCalendarDay[] = [];
    const startMs = parseIsoDateMs(rangeStart);
    const endMs = parseIsoDateMs(rangeEnd);
    for (let ms = startMs; ms <= endMs; ms += MS_PER_DAY) {
      const date = formatIsoDateMs(ms);
      const daySessions = sessionsByDate.get(date) ?? [];
      const hasCompleted = daySessions.some(
        (s) => !s.isJolly && s.completedAt !== null,
      );
      const hasJollyInstead = daySessions.some(
        (s) => s.isJolly && s.jollyMode === 'instead',
      );
      const hasJollyExtra = daySessions.some(
        (s) => s.isJolly && s.jollyMode === 'extra',
      );
      days.push({
        date,
        status: hasCompleted
          ? 'completed'
          : hasJollyInstead
            ? 'jolly_instead'
            : hasJollyExtra
              ? 'jolly_extra'
              : 'unscheduled',
        plannedDay: null,
        skippedLabel: null,
        sessions: daySessions,
        events: [],
      });
    }

    return { schedule: null, days, today, rangeStart, rangeEnd };
  }

  const simFrom =
    rangeStart < schedule.rotationAnchorDate
      ? rangeStart
      : schedule.rotationAnchorDate;
  const events = await listScheduleEvents(userId, schedule.id, {
    from: simFrom,
    to: rangeEnd,
  });
  const sessions = await listWorkoutSessions(userId, {
    from: simFrom,
    to: rangeEnd,
    includeExercises: false,
  });

  const projected = projectCalendar({
    queue: toQueueDays(schedule.days),
    anchorDate: schedule.rotationAnchorDate,
    anchorIndex: schedule.rotationAnchorIndex,
    events: toQueueEvents(events),
    sessions: toQueueSessions(sessions),
    today,
    rangeStart,
    rangeEnd,
  });

  const dayById = new Map(schedule.days.map((d) => [d.id, d]));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const eventById = new Map(events.map((e) => [e.id, e]));

  const hydrated: HydratedCalendarDay[] = projected.map((entry) => ({
    date: entry.date,
    status: entry.status,
    plannedDay: entry.plannedDay ? (dayById.get(entry.plannedDay.id) ?? null) : null,
    skippedLabel: entry.skippedLabel,
    sessions: entry.sessions
      .map((s) => sessionById.get(s.id))
      .filter((s): s is WorkoutSession => Boolean(s)),
    events: entry.events
      .map((e) => (e.id ? eventById.get(e.id) : undefined))
      .filter((e): e is ScheduleEvent => Boolean(e)),
  }));

  return { schedule, days: hydrated, today, rangeStart, rangeEnd };
}

export interface CreateScheduleEventInput {
  userId: string;
  scheduleId: string;
  eventDate: string;
  eventType: ScheduleEventType;
  shiftDays?: 1 | 2 | 3 | null;
  jollyLabel?: string | null;
}

export async function createScheduleEvent(
  input: CreateScheduleEventInput,
): Promise<ScheduleEvent> {
  const id = `se_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const shiftDays =
    input.eventType === 'postpone' ? (input.shiftDays ?? 1) : null;
  const jollyLabel =
    input.eventType === 'jolly_extra' || input.eventType === 'jolly_instead'
      ? (input.jollyLabel?.trim() || null)
      : null;

  await withTransaction(async () => {
    // Replace conflicting same-date planning overrides cleanly so changing mind
    // on today's action doesn't leave stale overlapping events on that same date.
    if (
      input.eventType === 'reset' ||
      input.eventType === 'postpone' ||
      input.eventType === 'skip' ||
      input.eventType === 'jolly_instead'
    ) {
      await query(
        `DELETE FROM schedule_events
         WHERE user_id = $1 AND schedule_id = $2 AND event_date = $3
           AND event_type IN ('postpone', 'skip', 'jolly_instead')`,
        [input.userId, input.scheduleId, input.eventDate],
      );
    }

    await query(
      `INSERT INTO schedule_events (id, user_id, schedule_id, event_date, event_type, shift_days, jolly_label, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        input.userId,
        input.scheduleId,
        input.eventDate,
        input.eventType,
        shiftDays,
        jollyLabel,
        createdAt,
      ],
    );
  });

  return {
    id,
    userId: input.userId,
    scheduleId: input.scheduleId,
    eventDate: input.eventDate,
    eventType: input.eventType,
    shiftDays,
    jollyLabel,
    createdAt,
  };
}

export async function deleteScheduleEventsByDateOrId(opts: {
  userId: string;
  scheduleId: string;
  id?: string;
  eventDate?: string;
}): Promise<number> {
  if (opts.id) {
    const info = await query(
      'DELETE FROM schedule_events WHERE id = $1 AND user_id = $2 AND schedule_id = $3',
      [opts.id, opts.userId, opts.scheduleId],
    );
    return Number(info.rowCount);
  }
  if (opts.eventDate) {
    const info = await query(
      'DELETE FROM schedule_events WHERE event_date = $1 AND user_id = $2 AND schedule_id = $3',
      [opts.eventDate, opts.userId, opts.scheduleId],
    );
    return Number(info.rowCount);
  }
  return 0;
}
