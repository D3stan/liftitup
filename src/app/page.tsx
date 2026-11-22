'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type {
  HydratedCalendarDay,
  ProjectUserCalendarResult,
} from '@/lib/schedule/repo';
import { ApiClientError, apiFetch, toast } from '@/components/ui';
import {
  addDays,
  formatLocalDate,
  getWeekStartMonday,
} from '@/components/calendar/dateUtils';
import { WeekCalendar } from '@/components/calendar/WeekCalendar';
import { TodayCard } from '@/components/calendar/TodayCard';
import { PlanActionsSheet } from '@/components/calendar/PlanActionsSheet';
import { useCurrentUser } from '@/components/shell/AppShell';
import { useActiveWorkout } from '@/components/workout/useActiveWorkout';
import type { RotationSchedule } from '@/types/domain';

export default function HomePage() {
  const user = useCurrentUser();
  const activeWorkout = useActiveWorkout(user?.id ?? null);
  const [today] = useState<string>(() => formatLocalDate(new Date()));
  const [weekStart, setWeekStart] = useState<string>(() =>
    getWeekStartMonday(formatLocalDate(new Date())),
  );
  const [days, setDays] = useState<HydratedCalendarDay[]>([]);
  const [schedule, setSchedule] = useState<RotationSchedule | null>(null);
  const [todayDay, setTodayDay] = useState<HydratedCalendarDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [planOpen, setPlanOpen] = useState(false);

  const loadCalendar = useCallback(
    async (targetWeekStart: string) => {
      setLoading(true);
      try {
        const weekEnd = addDays(targetWeekStart, 6);
        const params = new URLSearchParams({
          start: targetWeekStart,
          end: weekEnd,
          today,
        });
        const data = await apiFetch<ProjectUserCalendarResult>(
          `/api/calendar?${params.toString()}`,
        );
        setDays(data.days);
        setSchedule(data.schedule);

        const matchToday = data.days.find((d) => d.date === today);
        if (matchToday) {
          setTodayDay(matchToday);
        } else {
          // If browsing another week, keep TodayCard synced to actual `today`.
          const todayRes = await apiFetch<ProjectUserCalendarResult>(
            `/api/calendar?start=${today}&end=${today}&today=${today}`,
          );
          setTodayDay(todayRes.days[0] ?? null);
        }
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          return;
        }
        toast.error(
          err instanceof Error ? err.message : 'Failed to load calendar',
        );
      } finally {
        setLoading(false);
      }
    },
    [today],
  );

  useEffect(() => {
    void loadCalendar(weekStart);
  }, [weekStart, loadCalendar]);

  return (
    <div className="space-y-4">
      <WeekCalendar
        weekStart={weekStart}
        today={today}
        days={days}
        loading={loading}
        onPrevWeek={() => setWeekStart((w) => addDays(w, -7))}
        onNextWeek={() => setWeekStart((w) => addDays(w, 7))}
        onJumpToday={() => setWeekStart(getWeekStartMonday(today))}
      />

      <TodayCard
        today={today}
        schedule={schedule}
        todayDay={todayDay}
        activeWorkout={activeWorkout}
        onOpenPlan={() => setPlanOpen(true)}
      />

      <PlanActionsSheet
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        today={today}
        todayDay={todayDay}
        onUpdated={() => loadCalendar(weekStart)}
      />
    </div>
  );
}
