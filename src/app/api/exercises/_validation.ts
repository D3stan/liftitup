import { ApiError } from '@/lib/api/handler';
import { parseNullableWeightStepKg as parseNullableWeightStepKgCore } from '@/lib/workouts/stepSize';
import type { TrackingType } from '@/types/domain';

export function parseNullableWeightStepKg(value: unknown): number | null {
  try {
    return parseNullableWeightStepKgCore(value);
  } catch (err) {
    throw ApiError.validation(
      err instanceof Error
        ? err.message
        : 'weightStepKg must be a positive number up to 100, or null',
    );
  }
}

export const VALID_TRACKING_TYPES = new Set<TrackingType>([
  'weight_reps',
  'bodyweight_reps',
  'weighted_bodyweight',
  'assisted_bodyweight',
  'time',
  'weight_time',
  'distance',
  'distance_time',
]);

export function isValidTrackingType(value: unknown): value is TrackingType {
  return (
    typeof value === 'string' &&
    VALID_TRACKING_TYPES.has(value as TrackingType)
  );
}

export { ApiError };
