import type {
  CatalogExercise,
  ExerciseCategory,
  ExerciseEquipment,
  TrackingType,
} from '@/lib/exercises/catalog';

export type {
  CatalogExercise,
  ExerciseCategory,
  ExerciseEquipment,
  TrackingType,
};

export type WeightUnit = 'kg' | 'lb';

export type RestClockMode = 'stopwatch' | 'countdown';

export type AppTheme =
  | 'notebook'
  | 'cutecore'
  | 'analog-horror'
  | 'brazilian-phonk'
  | 'future-funk'
  | 'lofi-art';

export type ThemeVariant = 'light' | 'dark';

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  heightCm: number | null;
  weightKg: number;
  age: number | null;
  trainingYears: number | null;
  unit: WeightUnit;
  timezone: string;
  theme: AppTheme;
  themeVariant: ThemeVariant;
  enableSetQuality: boolean;
  restClockMode: RestClockMode;
  appleFitnessEnabled: boolean;
  isGuest: boolean;
  lastActiveAt: string;
  createdAt: string;
}

export interface ApiKeyInfo {
  id: string;
  userId: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface BodyMetric {
  id: string;
  userId: string;
  measuredOn: string; // YYYY-MM-DD
  weightKg: number;
  source: string;
  createdAt: string;
}

export interface Exercise {
  id: string;
  userId: string | null;
  slug: string;
  name: string;
  trackingType: TrackingType;
  equipment: ExerciseEquipment | string;
  category: ExerciseCategory | string;
  defaultRestSeconds: number;
  isCustom: boolean;
  isHidden: boolean;
  aliases: string[];
  createdAt: string;
}

export interface ScheduleDayExercise {
  id: string;
  scheduleDayId: string;
  exerciseId: string;
  exerciseName?: string;
  trackingType?: TrackingType;
  orderIndex: number;
  targetSets: number;
  targetReps: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetTimeSeconds: number | null;
  targetWeightKg: number | null;
  targetDistanceM: number | null;
  restSeconds: number;
  notes: string;
}

export interface ScheduleDay {
  id: string;
  scheduleId: string;
  position: number;
  label: string;
  isRestDay: boolean;
  exercises: ScheduleDayExercise[];
}

export interface RotationSchedule {
  id: string;
  userId: string;
  name: string;
  isActive: boolean;
  rotationAnchorDate: string; // YYYY-MM-DD
  rotationAnchorIndex: number;
  createdAt: string;
  updatedAt: string;
  days: ScheduleDay[];
}

export type ScheduleEventType =
  | 'skip'
  | 'postpone'
  | 'reset'
  | 'jolly_extra'
  | 'jolly_instead';

export interface ScheduleEvent {
  id: string;
  userId: string;
  scheduleId: string;
  eventDate: string; // YYYY-MM-DD
  eventType: ScheduleEventType;
  shiftDays: 1 | 2 | 3 | null;
  jollyLabel: string | null;
  createdAt: string;
}

export type CalendarDayStatus =
  | 'planned'
  | 'rest'
  | 'completed'
  | 'skipped'
  | 'idle'
  | 'postponed'
  | 'jolly_extra'
  | 'jolly_instead'
  | 'unscheduled';

export type JollyMode = 'extra' | 'instead';

export interface WorkoutSetRepQuality {
  id: string;
  workoutSetId: string;
  repIndex: number; // 1-based
  qualityPct: number; // 0..100
}

export interface WorkoutSet {
  id: string;
  workoutExerciseId: string;
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  timeSeconds: number | null;
  distanceM: number | null;
  restSeconds: number | null;
  executionQualityPct: number | null;
  isCompleted: boolean;
  createdAt: string;
  repQualities?: WorkoutSetRepQuality[];
}

export interface WorkoutExercise {
  id: string;
  sessionId: string;
  exerciseId: string;
  exerciseName?: string;
  trackingType?: TrackingType;
  orderIndex: number;
  notes: string;
  sets: WorkoutSet[];
}

export interface WorkoutSession {
  id: string;
  userId: string;
  sessionDate: string; // YYYY-MM-DD
  scheduleId: string | null;
  scheduleDayId: string | null;
  isJolly: boolean;
  jollyMode: JollyMode | null;
  title: string;
  startedAt: string;
  completedAt: string | null;
  durationMinutes: number | null;
  userWeightKg: number | null;
  notes: string;
  appleWatchKcal: number | null;
  appleWatchAvgHr: number | null;
  appleWatchMaxHr: number | null;
  cid: string | null;
  exercises: WorkoutExercise[];
}

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  status: CalendarDayStatus;
  plannedDay: ScheduleDay | null;
  skippedLabel?: string | null;
  sessions: WorkoutSession[];
}

export interface AppleHealthWorkout {
  id: string;
  userId: string;
  workoutType: string;
  startedAt: string;
  durationMinutes: number;
  activeCalories: number;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  bodyweightKg: number | null;
  linkedSessionId: string | null;
  source: string;
  createdAt: string;
}

export interface ExercisePrefill {
  exerciseId: string;
  lastSessionDate: string;
  sets: Array<{
    setNumber: number;
    weightKg: number | null;
    reps: number | null;
    timeSeconds: number | null;
    distanceM: number | null;
    restSeconds: number | null;
  }>;
}
