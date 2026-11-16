import type { TrackingType, UserProfile, WeightUnit } from '@/types/domain';

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const REPLACE_CONFIRMATION_WORD = 'REPLACE';

export type RestoreMode = 'merge' | 'replace';

export type UnmatchedExerciseResolution =
  | { action: 'map'; targetExerciseId: string }
  | { action: 'create_custom'; name?: string; trackingType: TrackingType };

export interface LiftitupRestoreValidationError {
  path: string;
  message: string;
}

export interface LiftitupRestorePreview {
  mode: RestoreMode;
  unit: WeightUnit;
  exportedAt: string | null;
  sessionsCount: number;
  dateRange: { from: string; to: string } | null;
  exercisesMatchedCount: number;
  customExercisesFromExport: Array<{
    oldId: string;
    name: string;
    trackingType: TrackingType;
    weightStepKg: number | null;
    alreadyExists: boolean;
  }>;
  unmatchedExercises: Array<{
    key: string;
    name: string;
    suggestedTrackingType: TrackingType;
    occurrences: number;
  }>;
  availableExercises: Array<{
    id: string;
    name: string;
    trackingType: TrackingType;
    isCustom: boolean;
  }>;
  bodyMetricsCount: number;
  hiddenExercisesCount: number;
  exerciseStepPrefsCount: number;
  activeScheduleSummary: {
    name: string;
    daysCount: number;
    eventsCount: number;
    willKeepExisting: boolean;
  } | null;
  warnings: string[];
  replaceWarning: {
    willDelete: string[];
    cannotRestore: string[];
    preserves: string[];
  };
}

export interface LiftitupValidateResult {
  valid: boolean;
  errors: LiftitupRestoreValidationError[];
  preview: LiftitupRestorePreview | null;
}

export interface LiftitupApplyResult {
  mode: RestoreMode;
  sessionsCreated: number;
  sessionsSkipped: number;
  bodyMetricsCreated: number;
  bodyMetricsSkipped: number;
  customExercisesCreated: number;
  customExercisesReused: number;
  hiddenExercisesApplied: number;
  exerciseStepPrefsApplied: number;
  exerciseStepPrefsSkipped: number;
  splitRestored: boolean;
  splitKeptExisting: boolean;
  scheduleEventsCreated: number;
  skippedItems: Array<{ item: string; reason: string }>;
  user: UserProfile;
}
