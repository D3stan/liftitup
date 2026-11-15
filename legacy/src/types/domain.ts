export type MuscleGroup =
  | 'chest'
  | 'lats'
  | 'upper_back'
  | 'front_delts'
  | 'side_delts'
  | 'rear_delts'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'biceps'
  | 'triceps'
  | 'calves'
  | 'abs';

export type MovementSlot =
  | 'horizontal_press'
  | 'incline_press'
  | 'chest_isolation'
  | 'vertical_pull'
  | 'horizontal_pull'
  | 'vertical_press'
  | 'lateral_delt'
  | 'rear_delt'
  | 'squat_pattern'
  | 'hinge_pattern'
  | 'knee_extension'
  | 'knee_flexion'
  | 'elbow_flexion'
  | 'elbow_extension'
  | 'calf_core';

export type LoadType = 'external' | 'unilateral_db' | 'bodyweight_plus';

export type EquipmentType =
  | 'barbell'
  | 'dumbbell'
  | 'cable'
  | 'machine'
  | 'bodyweight_weighted'
  | 'smith';

export type RankTier =
  | 'Iron'
  | 'Bronze'
  | 'Silver'
  | 'Gold'
  | 'Diamond'
  | 'Titan'
  | 'Olympian';

export type ProgressionType =
  | 'load_up'
  | 'add_rep'
  | 'hold'
  | 'variation_equiv'
  | 'new_slot';

export interface SecondaryMuscleFactor {
  muscle: MuscleGroup;
  factor: number; // e.g. 0.5 for fractional volume landmark accounting
}

export interface ExerciseDefinition {
  id: string;
  name: string;
  movementSlot: MovementSlot;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: SecondaryMuscleFactor[];
  loadType: LoadType;
  equipment: EquipmentType;
  bodyweightFactor: number; // e.g. 0.95 for weighted chin-ups/pull-ups, 0.90 for dips, 0 for external
  canonicalEquivalenceRatio: number; // multiplier relative to movementSlot anchor exercise
  defaultStepKg: number; // e.g. 2.5 or 1.25
  defaultRepMin: number;
  defaultRepMax: number;
  defaultRestSeconds: number;
  formCues: string[];
}

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  bodyweightKg: number;
  unit: 'kg' | 'lb';
  xp: number;
  xpToNextLevel?: number;
  level: number;
  rankTier: RankTier;
  currentStreak: number;
  bestStreak: number;
  streakShields: number;
  apiKey: string;
  appleFitnessEnabled: boolean;
  createdAt: string;
}

export interface ScheduleSlot {
  id: string;
  scheduleDayId?: string;
  slotIndex: number;
  movementSlot: MovementSlot;
  exerciseId: string;
  exerciseName?: string;
  targetSets: number;
  repRangeMin: number;
  repRangeMax: number;
  targetRir: number;
  restSeconds: number;
  notes?: string;
}

export interface ScheduleDay {
  id: string;
  scheduleId?: string;
  dayOfWeek: number; // 0 = Monday .. 6 = Sunday
  dayName: string; // e.g. "Monday"
  routineLabel: string; // e.g. "Push A — Chest & Side Delts" or "Rest Day"
  isRestDay: boolean;
  focusMuscles: MuscleGroup[];
  slots: ScheduleSlot[];
}

export interface Schedule {
  id: string;
  userId: string;
  name: string;
  splitType: 'upper_lower' | 'ppl' | 'arnold' | 'full_body' | 'custom';
  isActive: boolean;
  days: ScheduleDay[];
  updatedAt: string;
}

export interface PrecompiledSet {
  setNumber: number;
  targetWeightKg: number;
  targetReps: number;
  targetRir: number;
  effectiveLoadKg: number;
  previousWeightKg?: number | null;
  previousReps?: number | null;
  previousRir?: number | null;
  isWarmup?: boolean;
  completed?: boolean;
  actualWeightKg?: number;
  actualReps?: number;
  actualRir?: number;
}

export interface PrecompiledSlot {
  slotIndex: number;
  scheduleSlotId: string;
  movementSlot: MovementSlot;
  exercise: ExerciseDefinition;
  defaultExerciseId: string;
  isSwappedVariation: boolean;
  swappedFromExerciseName?: string;
  targetSets: number;
  repRangeMin: number;
  repRangeMax: number;
  targetRir: number;
  restSeconds: number;
  progressionType: ProgressionType;
  progressionBadge: string; // e.g. "LOAD UP +2.5kg", "+1 REP TARGET", "HOLD & OWN", "VARIATION EQUIV"
  progressionReason: string; // Sticky note explanation
  previousSummary: string; // e.g. "Last: 80kg × 10, 10, 9 @ RIR 1 (5d ago)"
  slotCanonicalE1rmKg: number;
  exerciseE1rmKg: number;
  sets: PrecompiledSet[];
   siblingsInSlot: ExerciseDefinition[];
}

export interface PrecompiledSession {
  date: string; // YYYY-MM-DD
  dayOfWeek: number;
  scheduleId: string;
  scheduleName: string;
  scheduleDayId: string;
  routineLabel: string;
  isRestDay: boolean;
  focusMuscles: MuscleGroup[];
  estimatedDurationMin: number;
  userBodyweightKg: number;
  slots: PrecompiledSlot[];
  alreadyCompletedToday?: boolean;
  completedSessionId?: string | null;
}

export interface VariationSwapRequest {
  fromExerciseId: string;
  toExerciseId: string;
  scheduleSlotId?: string;
  targetReps?: number;
  targetRir?: number;
  scope: 'session' | 'schedule';
}

export interface VariationSwapResponse {
  fromExercise: ExerciseDefinition;
  toExercise: ExerciseDefinition;
  recommendedWeightKg: number; // For bodyweight_plus, this is added external weight on belt
  effectiveLoadKg: number; // Total load moved including bodyweight * factor
  slotCanonicalE1rm: number;
  targetReps: number;
  targetRir: number;
  scope: 'session' | 'schedule';
  explanationNote: string;
  sets: PrecompiledSet[];
}

export interface WorkoutSet {
  id?: string;
  sessionId?: string;
  exerciseId: string;
  exerciseName?: string;
  movementSlot: MovementSlot;
  setNumber: number;
  weightKg: number; // External weight (or added weight for bodyweight_plus)
  effectiveLoadKg?: number;
  reps: number;
  rir: number;
  e1rmKg?: number;
  isPr?: boolean;
  completedAt?: string;
}

export interface WorkoutSession {
  id: string;
  userId: string;
  scheduleDayId?: string | null;
  routineLabel: string;
  startedAt: string;
  completedAt: string;
  durationMinutes: number;
  userBodyweightKg: number;
  totalVolumeKg: number;
  totalSets: number;
  xpEarned: number;
  prsCount: number;
  notes?: string;
  appleWatchKcal?: number | null;
  appleWatchAvgHr?: number | null;
  appleWatchMaxHr?: number | null;
  sets: WorkoutSet[];
  cid?: string; // Client idempotency ID for offline outbox
}

export interface KpiBeforeAfter {
  label: string;
  before: string;
  after: string;
  deltaText: string;
  direction: 'up' | 'down' | 'neutral';
  hitTarget: boolean;
}

export interface SessionDebriefImpact {
  session: WorkoutSession;
  xpEarned: number;
  xpBreakdown: { label: string; xp: number }[];
  previousLevel: number;
  newLevel: number;
  leveledUp: boolean;
  previousRank: RankTier;
  newRank: RankTier;
  streakAfter: number;
  prsUnlocked: PrRecord[];
  muscleLandmarksCrossed: {
    muscle: MuscleGroup;
    previousSets: number;
    newSets: number;
    zone: 'below_mev' | 'mev' | 'mav_optimal' | 'mrv_danger';
  }[];
  beforeAfterKpis: KpiBeforeAfter[];
  coachTakeaway: string;
}

export interface MuscleVolumeLandmark {
  muscle: MuscleGroup;
  label: string;
  weeklySets: number; // Fractional sets (1.0 primary, 0.5 secondary)
  directSets: number;
  indirectSets: number;
  mv: number;
  mev: number;
  mavMin: number;
  mavMax: number;
  mrv: number;
  zone: 'below_mev' | 'mev_to_mav' | 'mav_sweet_spot' | 'mrv_overreaching';
  masteryLevel: number; // 1..4 discrete boxes
  masteryTitle: 'Novice' | 'Intermediate' | 'Advanced' | 'Freak';
  masteryXp: number;
}

export interface MuscleRecoveryStatus {
  muscle: MuscleGroup;
  label: string;
  recoveryPct: number; // 0..100
  status: 'fresh' | 'recovering' | 'fatigued';
  hoursSinceLastTrained: number | null;
  lastSetsLogged: number;
  readyInHours: number;
}

export interface E1rmTrendPoint {
  date: string;
  sessionLabel: string;
  exerciseId: string;
  exerciseName: string;
  movementSlot: MovementSlot;
  weightKg: number;
  effectiveLoadKg: number;
  reps: number;
  rir: number;
  exerciseE1rmKg: number;
  slotCanonicalE1rmKg: number;
  isSwappedVariation?: boolean;
}

export interface PrRecord {
  id: string;
  userId: string;
  exerciseId: string;
  exerciseName: string;
  movementSlot: MovementSlot;
  prType: 'e1rm' | 'weight_for_reps' | 'volume';
  weightKg: number;
  effectiveLoadKg: number;
  reps: number;
  e1rmKg: number;
  previousBestE1rmKg?: number | null;
  achievedAt: string;
}

export interface BossMilestone {
  id: string;
  title: string;
  subtitle: string;
  targetDescription: string;
  unlocked: boolean;
  progressPct: number;
  currentValueText: string;
  xpReward: number;
  icon: string;
}

export interface AppleHealthWorkout {
  id: string;
  userId: string;
  workoutType: string;
  startedAt: string;
  durationMinutes: number;
  activeCalories: number;
  avgHeartRate?: number | null;
  maxHeartRate?: number | null;
  bodyweightKg?: number | null;
  linkedSessionId?: string | null;
  source: 'shortcut_webhook' | 'file_import' | 'demo_seed';
}

export interface ConsistencyDay {
  date: string;
  trained: boolean;
  routineLabel?: string;
  volumeKg?: number;
  prsCount?: number;
  isScheduledRest?: boolean;
}

export interface AnalyticsSummary {
  user: UserProfile;
  weeklyTonnageKg: number;
  previousWeekTonnageKg: number;
  weeklySessionsCompleted: number;
  weeklySessionsTarget: number;
  volumeLandmarks: MuscleVolumeLandmark[];
  muscleRecovery: MuscleRecoveryStatus[];
  e1rmTrends: E1rmTrendPoint[];
  recentPrs: PrRecord[];
  bossMilestones: BossMilestone[];
  recentSessions: WorkoutSession[];
  appleHealthWorkouts: AppleHealthWorkout[];
  consistencyCalendar: ConsistencyDay[];
}

export interface ScheduleCompilePayload {
  mode: 'schedule' | 'workout_session';
  schedule?: {
    name: string;
    splitType: 'upper_lower' | 'ppl' | 'arnold' | 'full_body' | 'custom';
    days: {
      dayOfWeek: number;
      routineLabel: string;
      isRestDay: boolean;
      slots: {
        movementSlot?: MovementSlot;
        exerciseId: string;
        targetSets: number;
        repRangeMin: number;
        repRangeMax: number;
        targetRir: number;
        restSeconds: number;
        notes?: string;
      }[];
    }[];
  };
  workoutSession?: {
    routineLabel: string;
    durationMinutes?: number;
    notes?: string;
    sets: {
      exerciseId: string;
      setNumber: number;
      weightKg: number;
      reps: number;
      rir: number;
    }[];
  };
}

export interface WorkoutTabViewProps {
  user: UserProfile;
  precompiledSession: PrecompiledSession | null;
  schedule: Schedule | null;
  exercises: ExerciseDefinition[];
  recentSessions: WorkoutSession[];
  soundEnabled: boolean;
  activeMode?: 'workout' | 'schedule';
  onRefresh: () => Promise<void>;
  onSelectRoutineDay: (dayOfWeek: number) => Promise<void>;
  onSessionLogged: (impact: SessionDebriefImpact) => void;
  onScheduleUpdated: (schedule: Schedule) => void;
  onShowToast: (message: string, undoAction?: () => Promise<void>) => void;
}

export interface DashboardTabViewProps {
  user: UserProfile;
  analytics: AnalyticsSummary | null;
  exercises: ExerciseDefinition[];
  onRefresh: () => Promise<void>;
  onShowToast: (message: string) => void;
}

export interface IntegrationsTabViewProps {
  user: UserProfile;
  schedule: Schedule | null;
  precompiledSession: PrecompiledSession | null;
  analytics: AnalyticsSummary | null;
  exercises: ExerciseDefinition[];
  onRefresh: () => Promise<void>;
  onUserUpdated: (user: UserProfile) => void;
  onShowToast: (message: string) => void;
}
