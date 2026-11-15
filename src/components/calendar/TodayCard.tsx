'use client';

import React from 'react';
import Link from 'next/link';
import { MoreHorizontal, Play, ArrowUpRight } from 'lucide-react';
import type { HydratedCalendarDay } from '@/lib/schedule/repo';
import type { RotationSchedule } from '@/types/domain';
import { formatDayHeader } from './dateUtils';

interface TodayCardProps {
  today: string;
  schedule: RotationSchedule | null;
  todayDay: HydratedCalendarDay | null;
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

export function TodayCard({
  today,
  schedule,
  todayDay,
  onOpenPlan,
}: TodayCardProps) {
  if (!schedule) {
    return (
      <section className="card space-y-3" aria-label="Today">
        <div className="flex items-center justify-between gap-2">
          <span className="pill gold text-xs">TODAY</span>
          <span className="text-sm font-bold text-[#5d5446]">
            {formatDayHeader(today)}
          </span>
        </div>
        <h2 className="font-marker text-2xl text-[#1d1a16]">No split yet</h2>
        <div className="grid grid-cols-2 gap-2">
          <Link href="/split/edit" className="btn no-underline">
            Create split
          </Link>
          <Link href="/ai" className="btn alt no-underline">
            AI setup
          </Link>
        </div>
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

  const cardClass =
    todayDay?.status === 'planned' ? 'hero-card space-y-3' : 'card space-y-3';

  return (
    <section className={cardClass} aria-label="Today">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="pill bg-[#fbf5e4] text-xs">TODAY</span>
          <span className="text-sm font-bold text-[#1d1a16] truncate">
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
          <h2 className="font-marker text-2xl text-[#1d1a16] truncate">
            {info.title}
          </h2>
          {info.badge && (
            <div className="mt-1">
              <span className={`${info.badgeClass} text-xs`}>{info.badge}</span>
            </div>
          )}
        </div>

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
      </div>
    </section>
  );
}
