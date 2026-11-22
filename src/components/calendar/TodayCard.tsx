'use client';

import React from 'react';
import Link from 'next/link';
import { MoreHorizontal, Play, ArrowUpRight } from 'lucide-react';
import type { HydratedCalendarDay } from '@/lib/schedule/repo';
import type { ActiveWorkoutSummary } from '@/lib/workouts/activeDraft';
import type { RotationSchedule } from '@/types/domain';
import { formatDisplayDate } from '@/components/workout/trackingFormat';
import { formatDayHeader } from './dateUtils';

interface TodayCardProps {
  today: string;
  schedule: RotationSchedule | null;
  todayDay: HydratedCalendarDay | null;
  activeWorkout?: ActiveWorkoutSummary | null;
  onOpenPlan: () => void;
}

function getTodayHeadline(day: HydratedCalendarDay): {
  title: string;
  badge: string | null;
  badgeClass: string;
  isStartable: boolean;
} {
  const completedSession = day.sessions.find(
    (s) => !s.isJolly && s.completedAt !== null,
  );
  const jollySession = day.sessions.find((s) => s.isJolly);
  const jollyEvent = day.events.find(
    (e) => e.eventType === 'jolly_extra' || e.eventType === 'jolly_instead',
  );

  switch (day.status) {
    case 'completed':
      return {
        title: completedSession?.title || day.plannedDay?.label || 'Workout',
        badge: 'Done',
        badgeClass: 'pill green',
        isStartable: false,
      };
    case 'planned':
      return {
        title: day.plannedDay?.label || 'Workout',
        badge: null,
        badgeClass: 'pill',
        isStartable: true,
      };
    case 'rest':
      return {
        title: day.plannedDay?.label || 'Rest',
        badge: 'Rest',
        badgeClass: 'pill',
        isStartable: false,
      };
    case 'postponed':
      return {
        title: 'Postponed',
        badge: 'Off',
        badgeClass: 'pill',
        isStartable: false,
      };
    case 'skipped':
      return {
        title: day.skippedLabel || day.plannedDay?.label || 'Skipped',
        badge: 'Skipped',
        badgeClass: 'pill red',
        isStartable: false,
      };
    case 'jolly_extra':
      return {
        title: jollySession?.title || jollyEvent?.jollyLabel || 'Jolly extra',
        badge: 'Jolly +',
        badgeClass: 'pill blue',
        isStartable: !jollySession?.completedAt,
      };
    case 'jolly_instead':
      return {
        title: jollySession?.title || jollyEvent?.jollyLabel || 'Jolly',
        badge: 'Jolly',
        badgeClass: 'pill blue',
        isStartable: !jollySession?.completedAt,
      };
    default:
      return {
        title: 'Free day',
        badge: null,
        badgeClass: 'pill',
        isStartable: false,
      };
  }
}

function ActiveWorkoutCallout({
  today,
  activeWorkout,
}: {
  today: string;
  activeWorkout: ActiveWorkoutSummary;
}) {
  const dateLabel =
    activeWorkout.date === today
      ? 'Today'
      : formatDisplayDate(activeWorkout.date);
  const progressLabel =
    activeWorkout.totalWorkingSets > 0
      ? `${activeWorkout.completedWorkingSets}/${activeWorkout.totalWorkingSets} sets`
      : activeWorkout.completedWarmupSets > 0
        ? `${activeWorkout.completedWarmupSets} warmup sets`
        : null;

  return (
    <div className="flex items-center justify-between gap-2.5 rounded-[10px] border-[2.5px] border-[var(--line)] bg-[var(--green-bg)] p-2.5 text-[var(--ink)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="pill !bg-[var(--card)] !px-2 !py-0 text-[11px]">
            In progress
          </span>
          <span className="truncate text-xs font-bold text-[var(--muted)]">
            {progressLabel ? `${dateLabel} · ${progressLabel}` : dateLabel}
          </span>
        </div>
        <p className="mt-0.5 truncate font-marker text-base text-[var(--ink)]">
          {activeWorkout.title}
        </p>
      </div>
      <Link
        href={activeWorkout.href}
        className="btn shrink-0 no-underline !min-h-[44px] !px-3 text-sm"
      >
        <Play className="h-4 w-4" />
        <span>Resume workout</span>
      </Link>
    </div>
  );
}

export function TodayCard({
  today,
  schedule,
  todayDay,
  activeWorkout = null,
  onOpenPlan,
}: TodayCardProps) {
  const isActiveTodayPrimary = Boolean(
    activeWorkout &&
      activeWorkout.date === today &&
      ((activeWorkout.mode === 'planned' && todayDay?.status === 'planned') ||
        (activeWorkout.mode !== 'planned' &&
          (todayDay?.status === 'jolly_extra' ||
            todayDay?.status === 'jolly_instead'))),
  );
  const otherActiveWorkout =
    activeWorkout && !isActiveTodayPrimary ? activeWorkout : null;

  if (!schedule) {
    return (
      <section className="card space-y-3" aria-label="Today">
        <div className="flex items-center justify-between gap-2">
          <span className="pill gold text-xs text-[var(--btn-gold-fg)]">TODAY</span>
          <span className="text-sm font-bold text-[var(--muted)]">
            {formatDayHeader(today)}
          </span>
        </div>
        <h2 className="font-marker text-2xl text-[var(--ink)]">No split yet</h2>
        <div className="grid grid-cols-2 gap-2">
          <Link href="/split/edit" className="btn no-underline">
            Create split
          </Link>
          <Link href="/ai" className="btn alt no-underline">
            AI setup
          </Link>
        </div>
        {otherActiveWorkout && (
          <ActiveWorkoutCallout
            today={today}
            activeWorkout={otherActiveWorkout}
          />
        )}
      </section>
    );
  }

  const info = todayDay
    ? getTodayHeadline(todayDay)
    : {
        title: 'Workout',
        badge: null,
        badgeClass: 'pill',
        isStartable: false,
      };

  const isPlannedToday = todayDay?.status === 'planned';
  const cardClass = isPlannedToday ? 'hero-card space-y-3' : 'card space-y-3';
  const cardFgClass = isPlannedToday
    ? 'text-[var(--btn-gold-fg)]'
    : 'text-[var(--ink)]';
  const activeProgressText =
    isActiveTodayPrimary && activeWorkout
      ? activeWorkout.totalWorkingSets > 0
        ? `In progress · ${activeWorkout.completedWorkingSets}/${activeWorkout.totalWorkingSets} sets`
        : 'In progress'
      : null;

  return (
    <section className={cardClass} aria-label="Today">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="pill bg-[var(--card)] text-[var(--ink)] text-xs">TODAY</span>
          <span className={`text-sm font-bold truncate ${cardFgClass}`}>
            {formatDayHeader(today)}
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenPlan}
          className="btn alt min-h-[44px] px-3 py-1.5 text-base shrink-0"
        >
          <MoreHorizontal className="h-4 w-4" />
          Plan
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`font-marker text-2xl truncate ${cardFgClass}`}>
            {info.title}
          </h2>
          {activeProgressText ? (
            <div className="mt-1">
              <span className="pill green text-xs text-[var(--ink)]">
                {activeProgressText}
              </span>
            </div>
          ) : (
            info.badge && (
              <div className="mt-1">
                <span className={`${info.badgeClass} text-xs`}>{info.badge}</span>
              </div>
            )
          )}
        </div>

        {isActiveTodayPrimary && activeWorkout ? (
          <Link
            href={activeWorkout.href}
            className="btn green shrink-0 no-underline"
          >
            <Play className="h-4 w-4" />
            <span>Resume workout</span>
          </Link>
        ) : (
          <Link
            href={`/workout/${today}`}
            className={`btn shrink-0 no-underline ${
              todayDay?.status === 'planned' ? 'alt' : ''
            }`}
          >
            {info.isStartable ? (
              <>
                <Play className="h-4 w-4" />
                Start
              </>
            ) : (
              <>
                Open
                <ArrowUpRight className="h-4 w-4" />
              </>
            )}
          </Link>
        )}
      </div>

      {otherActiveWorkout && (
        <ActiveWorkoutCallout
          today={today}
          activeWorkout={otherActiveWorkout}
        />
      )}
    </section>
  );
}
