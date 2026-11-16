import type {
  BodyMetric,
  Exercise,
  RestClockMode,
  RotationSchedule,
  ScheduleEvent,
  UserProfile,
  WorkoutSession,
  WorkoutSetRepQuality,
} from '@/types/domain';
import { listBodyMetrics } from '@/lib/db/bodyMetrics';
import { localDateForTimezone } from '@/lib/db/users';
import {
  getActiveSchedule,
  listScheduleEvents,
  listWorkoutSessions,
} from '@/lib/db/workouts';
import { listExercises } from '@/lib/exercises/repository';

export interface ExportJsonPayload {
  schemaVersion: 2;
  exportedAt: string;
  user: {
    username: string;
    displayName: string;
    heightCm: number | null;
    weightKg: number;
    age: number | null;
    trainingYears: number | null;
    unit: 'kg' | 'lb';
    timezone: string;
    enableSetQuality: boolean;
    restClockMode: RestClockMode;
  };
  activeSchedule: {
    id: string;
    name: string;
    anchorDate: string;
    anchorIndex: number;
    days: Array<{
      id: string;
      position: number;
      label: string;
      isRestDay: boolean;
      exercises: RotationSchedule['days'][number]['exercises'];
    }>;
  } | null;
  exercises: {
    custom: Exercise[];
    hiddenIds: string[];
  };
  bodyMetrics: BodyMetric[];
  scheduleEvents: ScheduleEvent[];
  sessions: Array<{
    id: string;
    sessionDate: string;
    scheduleId: string | null;
    scheduleDayId: string | null;
    title: string;
    isJolly: boolean;
    jollyMode: 'extra' | 'instead' | null;
    startedAt: string;
    completedAt: string | null;
    durationMinutes: number | null;
    userWeightKg: number | null;
    notes: string;
    appleHealth: {
      kcal: number | null;
      avgHr: number | null;
      maxHr: number | null;
    };
    exercises: Array<{
      exerciseId: string;
      name: string;
      trackingType: string;
      orderIndex: number;
      notes: string;
      sets: Array<{
        setNumber: number;
        weightKg: number | null;
        reps: number | null;
        timeSeconds: number | null;
        distanceM: number | null;
        restSeconds: number | null;
        actualRestSeconds: number | null;
        restApproximate: boolean;
        executionQualityPct: number | null;
        isCompleted: boolean;
        repQualities: Array<{
          repIndex: number;
          qualityPct: number;
        }>;
      }>;
    }>;
  }>;
}

export const CSV_HEADERS = [
  'session_id',
  'session_date',
  'session_title',
  'is_jolly',
  'jolly_mode',
  'duration_minutes',
  'user_weight_kg',
  'session_notes',
  'exercise_order',
  'exercise_id',
  'exercise_name',
  'tracking_type',
  'exercise_notes',
  'set_number',
  'weight_kg',
  'reps',
  'time_seconds',
  'distance_m',
  'rest_seconds',
  'actual_rest_seconds',
  'rest_approximate',
  'execution_quality_pct',
  'rep_qualities',
  'is_completed',
] as const;

export async function buildUserExportJson(user: UserProfile): Promise<ExportJsonPayload> {
  const activeSchedule = await getActiveSchedule(user.id);
  const allExercises = await listExercises(user.id, { includeHidden: true });
  const customExercises = allExercises.filter((ex) => ex.isCustom);
  const hiddenIds = allExercises.filter((ex) => ex.isHidden).map((ex) => ex.id);
  const scheduleEvents = activeSchedule
    ? await listScheduleEvents(user.id, activeSchedule.id)
    : [];
  const bodyMetrics = await listBodyMetrics(user.id);
  const sessions = await listWorkoutSessions(user.id);

  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    user: {
      username: user.username,
      displayName: user.displayName,
      heightCm: user.heightCm,
      weightKg: user.weightKg,
      age: user.age,
      trainingYears: user.trainingYears,
      unit: user.unit,
      timezone: user.timezone,
      enableSetQuality: user.enableSetQuality,
      restClockMode: user.restClockMode,
    },
    activeSchedule: activeSchedule
      ? {
          id: activeSchedule.id,
          name: activeSchedule.name,
          anchorDate: activeSchedule.rotationAnchorDate,
          anchorIndex: activeSchedule.rotationAnchorIndex,
          days: activeSchedule.days.map((d) => ({
            id: d.id,
            position: d.position,
            label: d.label,
            isRestDay: d.isRestDay,
            exercises: d.exercises,
          })),
        }
      : null,
    exercises: {
      custom: customExercises,
      hiddenIds,
    },
    bodyMetrics,
    scheduleEvents,
    sessions: sessions.map(mapExportSession),
  };
}

function mapExportSession(
  session: WorkoutSession,
): ExportJsonPayload['sessions'][number] {
  return {
    id: session.id,
    sessionDate: session.sessionDate,
    scheduleId: session.scheduleId,
    scheduleDayId: session.scheduleDayId,
    title: session.title,
    isJolly: session.isJolly,
    jollyMode: session.jollyMode,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    durationMinutes: session.durationMinutes,
    userWeightKg: session.userWeightKg,
    notes: session.notes,
    appleHealth: {
      kcal: session.appleWatchKcal,
      avgHr: session.appleWatchAvgHr,
      maxHr: session.appleWatchMaxHr,
    },
    exercises: session.exercises.map((ex) => ({
      exerciseId: ex.exerciseId,
      name: ex.exerciseName ?? ex.exerciseId,
      trackingType: ex.trackingType ?? 'weight_reps',
      orderIndex: ex.orderIndex,
      notes: ex.notes,
      sets: ex.sets.map((s) => ({
        setNumber: s.setNumber,
        weightKg: s.weightKg,
        reps: s.reps,
        timeSeconds: s.timeSeconds,
        distanceM: s.distanceM,
        restSeconds: s.restSeconds,
        actualRestSeconds: s.actualRestSeconds,
        restApproximate: s.restApproximate,
        executionQualityPct: s.executionQualityPct,
        isCompleted: s.isCompleted,
        repQualities: (s.repQualities ?? []).map((rq) => ({
          repIndex: rq.repIndex,
          qualityPct: rq.qualityPct,
        })),
      })),
    })),
  };
}

export function formatRepQualitiesCsv(
  repQualities?: WorkoutSetRepQuality[],
): string {
  if (!repQualities || repQualities.length === 0) return '';
  return [...repQualities]
    .sort((a, b) => a.repIndex - b.repIndex)
    .map((rq) => `${rq.repIndex}:${rq.qualityPct}`)
    .join(';');
}

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function buildUserExportCsv(user: UserProfile): Promise<string> {
  const sessions = await listWorkoutSessions(user.id);
  const chronological = [...sessions].sort((a, b) => {
    const cmp = a.sessionDate.localeCompare(b.sessionDate);
    if (cmp !== 0) return cmp;
    return a.startedAt.localeCompare(b.startedAt);
  });

  const lines: string[] = [CSV_HEADERS.join(',')];

  for (const session of chronological) {
    for (const ex of session.exercises) {
      for (const set of ex.sets) {
        const row = [
          session.id,
          session.sessionDate,
          session.title,
          session.isJolly ? 1 : 0,
          session.jollyMode ?? '',
          session.durationMinutes ?? '',
          session.userWeightKg ?? '',
          session.notes,
          ex.orderIndex,
          ex.exerciseId,
          ex.exerciseName ?? ex.exerciseId,
          ex.trackingType ?? 'weight_reps',
          ex.notes,
          set.setNumber,
          set.weightKg ?? '',
          set.reps ?? '',
          set.timeSeconds ?? '',
          set.distanceM ?? '',
          set.restSeconds ?? '',
          set.actualRestSeconds ?? '',
          set.restApproximate ? 1 : 0,
          set.executionQualityPct ?? '',
          formatRepQualitiesCsv(set.repQualities),
          set.isCompleted ? 1 : 0,
        ];
        lines.push(row.map(escapeCsvCell).join(','));
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

export function getExportFilename(
  user: UserProfile,
  format: 'json' | 'csv',
): string {
  const today = localDateForTimezone(user.timezone);
  return `liftitup-export-${today}.${format}`;
}
