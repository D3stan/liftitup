import type { ProgressPhotoPose } from '@/types/domain';

export const PHOTO_POSES = ['front', 'side', 'back'] as const;

export const DEFAULT_PHOTO_QUOTA = 300;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_THUMB_BYTES = 512 * 1024; // 512 KB
export const MAX_UPLOAD_REQUEST_BYTES =
  MAX_PHOTO_BYTES + MAX_THUMB_BYTES + 128 * 1024;

export const PHOTO_ASPECT_RATIO = 3 / 4;
export const PHOTO_TARGET_LONG_EDGE_PX = 2000;
export const PHOTO_THUMB_LONG_EDGE_PX = 300;

export function isValidPhotoPose(val: unknown): val is ProgressPhotoPose {
  return val === 'front' || val === 'side' || val === 'back';
}

export function formatPhotoPoseLabel(pose: ProgressPhotoPose): string {
  switch (pose) {
    case 'front':
      return 'Front';
    case 'side':
      return 'Side';
    case 'back':
      return 'Back';
  }
}
