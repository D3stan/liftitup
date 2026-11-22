'use client';

import { useEffect, useState } from 'react';
import {
  DRAFT_PREFIX,
  WORKOUT_DRAFTS_CHANGED_EVENT,
} from '@/lib/offline/outbox';
import {
  areActiveWorkoutsEqual,
  findActiveUserWorkout,
  type ActiveWorkoutSummary,
} from '@/lib/workouts/activeDraft';

/**
 * Subscribes to the user's currently active (in-progress) workout draft in
 * `localStorage`, updating immediately on same-tab draft mutations, cross-tab
 * storage changes, user profile changes, and tab focus.
 */
export function useActiveWorkout(
  userId: string | null | undefined,
): ActiveWorkoutSummary | null {
  const [activeWorkout, setActiveWorkout] =
    useState<ActiveWorkoutSummary | null>(null);

  useEffect(() => {
    if (!userId) {
      setActiveWorkout(null);
      return;
    }

    const sync = () => {
      const next = findActiveUserWorkout(userId);
      setActiveWorkout((prev) =>
        areActiveWorkoutsEqual(prev, next) ? prev : next,
      );
    };

    sync();

    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith(DRAFT_PREFIX)) {
        sync();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        sync();
      }
    };

    window.addEventListener(WORKOUT_DRAFTS_CHANGED_EVENT, sync);
    window.addEventListener('liftitup:user-updated', sync);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener(WORKOUT_DRAFTS_CHANGED_EVENT, sync);
      window.removeEventListener('liftitup:user-updated', sync);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId]);

  return userId ? activeWorkout : null;
}
