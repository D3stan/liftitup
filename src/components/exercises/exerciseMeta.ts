import {
  Activity,
  Dumbbell,
  Hourglass,
  MinusCircle,
  MoveHorizontal,
  PlusCircle,
  Timer,
  User,
  type LucideIcon,
} from 'lucide-react';
import type { TrackingType } from '@/types/domain';

export interface TrackingTypeMeta {
  value: TrackingType;
  label: string;
  Icon: LucideIcon;
}

export const TRACKING_TYPE_OPTIONS: TrackingTypeMeta[] = [
  { value: 'weight_reps', label: 'Weight × reps', Icon: Dumbbell },
  { value: 'bodyweight_reps', label: 'Bodyweight reps', Icon: User },
  { value: 'weighted_bodyweight', label: 'Weighted BW', Icon: PlusCircle },
  { value: 'assisted_bodyweight', label: 'Assisted BW', Icon: MinusCircle },
  { value: 'time', label: 'Time', Icon: Timer },
  { value: 'weight_time', label: 'Weight × time', Icon: Hourglass },
  { value: 'distance', label: 'Distance', Icon: MoveHorizontal },
  { value: 'distance_time', label: 'Distance + time', Icon: Activity },
];

export const TRACKING_TYPE_MAP: Record<TrackingType, TrackingTypeMeta> =
  Object.fromEntries(
    TRACKING_TYPE_OPTIONS.map((item) => [item.value, item]),
  ) as Record<TrackingType, TrackingTypeMeta>;

export interface OptionItem {
  value: string;
  label: string;
}

export const CATEGORY_OPTIONS: OptionItem[] = [
  { value: 'push', label: 'Push' },
  { value: 'pull', label: 'Pull' },
  { value: 'legs', label: 'Legs' },
  { value: 'core', label: 'Core' },
  { value: 'full_body', label: 'Full body' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'skill', label: 'Skill' },
  { value: 'other', label: 'Other' },
];

export const EQUIPMENT_OPTIONS: OptionItem[] = [
  { value: 'barbell', label: 'Barbell' },
  { value: 'dumbbell', label: 'Dumbbell' },
  { value: 'machine', label: 'Machine' },
  { value: 'cable', label: 'Cable' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'kettlebell', label: 'Kettlebell' },
  { value: 'band', label: 'Band' },
  { value: 'smith', label: 'Smith' },
  { value: 'other', label: 'Other' },
];
