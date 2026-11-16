'use client';

import React from 'react';
import Link from 'next/link';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import type { HydratedCalendarDay } from '@/lib/schedule/repo';
import {
  addDays,
  formatWeekRange,
  getDayCellParts,
} from './dateUtils';

interface WeekCalendarProps {
  weekStart: string;
  today: string;
  days: HydratedCalendarDay[];
  loading: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onJumpToday: () => void;
}

function getCellStyle(day: HydratedCalendarDay, isToday: boolean): string {
  switch (day.status) {
    case 'completed':
      return 'bg-[var(--green-bg)] border-[var(--line)]';
    case 'planned':
      return isToday
        ? 'bg-[var(--gold-bg)] border-[var(--line)]'
        : 'bg-[var(--card)] border-[var(--line)]';
    case 'rest':
      return 'bg-[var(--paper)] border-[var(--line)]/75';
    case 'skipped':
      return 'bg-[var(--red-bg)] border-[var(--line)]';
    case 'postponed':
      return 'bg-[var(--paper)] border-dashed border-[var(--line)]';
    case 'jolly_extra':
    case 'jolly_instead':
      return 'bg-[var(--blue-bg)] border-[var(--line)]';
    case 'idle':
    case 'unscheduled':
    default:
      return 'bg-[var(--card)]/55 border-[var(--line)]/45 text-[var(--muted)]';
  }
}

function getCellLabel(day: HydratedCalendarDay): string {
  switch (day.status) {
    case 'completed':
      return (
        day.sessions.find((s) => !s.isJolly && s.completedAt)?.title ||
        day.plannedDay?.label ||
        'Done'
      );
    case 'planned':
      return day.plannedDay?.label || 'Plan';
    case 'rest':
      return 'Rest';
    case 'skipped':
      return 'Skip';
    case 'postponed':
      return 'Off';
    case 'jolly_extra':
      return 'Jolly+';
    case 'jolly_instead':
      return 'Jolly';
    case 'idle':
    case 'unscheduled':
    default:
      return '—';
  }
}

export function WeekCalendar({
  weekStart,
  today,
  days,
  loading,
  onPrevWeek,
  onNextWeek,
  onJumpToday,
}: WeekCalendarProps) {
  const weekEnd = addDays(weekStart, 6);
  const isCurrentWeek = today >= weekStart && today <= weekEnd;

  return (
    <section className="card space-y-3" aria-label="Week calendar">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onPrevWeek}
          aria-label="Previous week"
          className="btn alt icon"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <h2 className="font-marker text-lg text-[var(--ink)] truncate">
            {formatWeekRange(weekStart, weekEnd)}
          </h2>
          {!isCurrentWeek && (
            <button
              type="button"
              onClick={onJumpToday}
              className="pill gold text-xs min-h-[32px] cursor-pointer"
            >
              Today
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onNextWeek}
          aria-label="Next week"
          className="btn alt icon"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div
        className={`grid grid-cols-7 gap-1.5 transition-opacity duration-150 ${
          loading ? 'opacity-60' : 'opacity-100'
        }`}
      >
        {(days.length === 7
          ? days
          : Array.from({ length: 7 }, (_, i) => ({
              date: addDays(weekStart, i),
              status: 'unscheduled' as const,
              plannedDay: null,
              skippedLabel: null,
              sessions: [],
              events: [],
            }))
        ).map((day) => {
          const { weekday, dayNum } = getDayCellParts(day.date);
          const isToday = day.date === today;
          const label = getCellLabel(day);

          return (
            <Link
              key={day.date}
              href={`/workout/${day.date}`}
              aria-current={isToday ? 'date' : undefined}
              className={`flex min-h-[78px] min-w-0 flex-col items-center justify-between rounded-[8px] border-[2.5px] px-1 py-1.5 text-center no-underline text-[var(--ink)] ${getCellStyle(
                day,
                isToday,
              )} ${
                isToday
                  ? 'shadow-[3px_3px_0_var(--shadow-color)] ring-2 ring-[var(--line)] ring-offset-1 ring-offset-[var(--card)]'
                  : ''
              }`}
            >
              <span className="text-[11px] font-bold uppercase leading-none text-[var(--muted)]">
                {weekday}
              </span>

              <span className="font-marker text-lg leading-none">{dayNum}</span>

              <span className="flex w-full items-center justify-center gap-0.5 text-[11px] font-bold leading-tight">
                {day.status === 'completed' && (
                  <Check className="h-3 w-3 shrink-0 text-[var(--green)]" />
                )}
                <span className="truncate">{label}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
