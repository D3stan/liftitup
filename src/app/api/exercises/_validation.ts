import type { TrackingType } from '@/types/domain';

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
