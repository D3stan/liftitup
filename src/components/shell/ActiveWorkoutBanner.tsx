'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Play } from 'lucide-react';
import {
  computeSessionElapsedSeconds,
  formatClockSeconds,
} from '@/lib/workouts/clock';
import {
  formatActiveWorkoutSubtitle,
  isPathnameOnActiveWorkout,
} from '@/lib/workouts/activeDraft';
import { localTodayYmd } from '@/components/workout/trackingFormat';
import { useActiveWorkout } from '@/components/workout/useActiveWorkout';

interface ActiveWorkoutBannerProps {
  userId: string | null;
}

export function ActiveWorkoutBanner({ userId }: ActiveWorkoutBannerProps) {
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
  const activeWorkout = useActiveWorkout(userId);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const onActiveRoute = isPathnameOnActiveWorkout(
    activeWorkout,
    pathname,
    searchParams,
  );
  const shouldShow = Boolean(activeWorkout && !onActiveRoute);
  const hasLiveClock = Boolean(
    shouldShow &&
      (activeWorkout?.startedAt || activeWorkout?.restClock?.isActive),
  );

  useEffect(() => {
    if (!hasLiveClock) return;
    const syncNow = () => setNowMs(Date.now());
    syncNow();
    const interval = window.setInterval(syncNow, 1000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', syncNow);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', syncNow);
    };
  }, [hasLiveClock]);

  if (!shouldShow || !activeWorkout) {
    return null;
  }

  const subtitle = formatActiveWorkoutSubtitle(
    activeWorkout,
    localTodayYmd(),
    nowMs,
  );

  return (
    <div
      role="region"
      aria-label="Active workout in progress"
      className="border-t-[2.5px] border-[var(--line)] bg-[var(--green-bg)] text-[var(--ink)]"
    >
      <div className="mx-auto max-w-2xl px-3 py-1.5">
        <Link
          href={activeWorkout.href}
          aria-label={`Resume workout: ${activeWorkout.title}`}
          className="flex min-h-[44px] items-center justify-between gap-2.5 no-underline text-[var(--ink)]"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--line)] bg-[var(--green)] animate-pulse motion-reduce:animate-none"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-marker text-sm leading-tight text-[var(--ink)]">
                  {activeWorkout.title}
                </span>
                {activeWorkout.startedAt && (
                  <span className="pill shrink-0 !px-1.5 !py-0 text-[11px] font-bold tabular-nums">
                    {formatClockSeconds(
                      computeSessionElapsedSeconds(activeWorkout.startedAt, nowMs),
                    )}
                  </span>
                )}
              </div>
              <p className="truncate text-xs font-bold text-[var(--muted)]">
                {subtitle}
              </p>
            </div>
          </div>

          <span className="btn shrink-0 !min-h-[38px] !px-3 !py-1 text-sm">
            <Play className="h-3.5 w-3.5" />
            <span>Resume</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
