import type {
  CalendarDayStatus,
  Exercise,
  ExercisePrefill,
  JollyMode,
  RestClockMode,
  ScheduleDay,
  WeightUnit,
  WorkoutSession,
} from '@/types/domain';
import type { QueueEvent } from '@/lib/schedule/queue';
import type { ExerciseStepMeta } from '@/lib/exercises/repository';

export interface WorkoutDayViewResponse {
  date: string;
  today: string;
  user: {
    id: string;
    unit: WeightUnit;
    weightKg: number;
    enableSetQuality: boolean;
    alwaysShowRir: boolean;
    enableSetNoteTags: boolean;
    enableSetNoteHint: boolean;
    restClockMode: RestClockMode;
    defaultWeightStepKg: number | null;
    timezone: string;
  };
  calendarDay: {
    date: string;
    status: CalendarDayStatus;
    plannedDay: ScheduleDay | null;
    skippedLabel: string | null;
    events: QueueEvent[];
  };
  sessions: WorkoutSession[];
  prefillByExerciseId: Record<string, ExercisePrefill>;
  exerciseStepsById?: Record<string, ExerciseStepMeta>;
}

export interface SaveWorkoutRepQualityInput {
  repIndex: number;
  qualityPct: number;
}

export interface SaveWorkoutSetInput {
  setNumber?: number;
  weightKg?: number | null;
  reps?: number | null;
  timeSeconds?: number | null;
  distanceM?: number | null;
  restSeconds?: number | null;
  actualRestSeconds?: number | null;
  restApproximate?: boolean;
  executionQualityPct?: number | null;
  rir?: number | null;
  notes?: string;
  isWarmup?: boolean;
  isCompleted?: boolean;
  repQualities?: SaveWorkoutRepQualityInput[];
}

export interface SaveWorkoutExerciseInput {
  exerciseId: string;
  orderIndex?: number;
  notes?: string;
  sets: SaveWorkoutSetInput[];
}

export interface SaveWorkoutSessionInput {
  sessionDate: string;
  scheduleDayId?: string | null;
  isJolly?: boolean;
  jollyMode?: JollyMode | null;
  title: string;
  startedAt?: string;
  completedAt?: string | null;
  durationMinutes?: number | null;
  userWeightKg?: number | null;
  notes?: string;
  cid?: string | null;
  exercises: SaveWorkoutExerciseInput[];
}

export interface UpdateWorkoutSessionInput {
  sessionDate?: string;
  isJolly?: boolean;
  jollyMode?: JollyMode | null;
  title?: string;
  startedAt?: string;
  completedAt?: string | null;
  durationMinutes?: number | null;
  userWeightKg?: number | null;
  notes?: string;
  exercises?: SaveWorkoutExerciseInput[];
}

export interface SwapExerciseInput {
  dateKey: string;
  scheduleDayExerciseId: string;
  toExerciseId?: string;
  scope: 'session' | 'schedule' | 'revert';
}

export interface SwapExerciseResult {
  ok: true;
  toExercise: Exercise;
  prefill: ExercisePrefill | null;
}
