'use client';

import React, { useEffect, useState } from 'react';
import { RotateCcw, SkipForward, Sparkles, Undo2 } from 'lucide-react';
import type { HydratedCalendarDay } from '@/lib/schedule/repo';
import type { ScheduleEventType } from '@/types/domain';
import { apiFetch, Button, Sheet, toast } from '@/components/ui';

interface PlanActionsSheetProps {
  open: boolean;
  onClose: () => void;
  today: string;
  todayDay: HydratedCalendarDay | null;
  onUpdated: () => Promise<void> | void;
}

export function PlanActionsSheet({
  open,
  onClose,
  today,
  todayDay,
  onUpdated,
}: PlanActionsSheetProps) {
  const [jollyLabel, setJollyLabel] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmReset(false);
      setJollyLabel('');
    }
  }, [open]);

  const isRestDay =
    todayDay?.status === 'rest' || Boolean(todayDay?.plannedDay?.isRestDay);
  const hasTodayEvents = (todayDay?.events.length ?? 0) > 0;

  async function triggerEvent(
    eventType: ScheduleEventType,
    shiftDays?: 1 | 2 | 3,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch('/api/schedule/events', {
        method: 'POST',
        body: JSON.stringify({
          eventDate: today,
          today,
          eventType,
          ...(shiftDays ? { shiftDays } : {}),
          ...(eventType === 'jolly_extra' || eventType === 'jolly_instead'
            ? { jollyLabel: jollyLabel.trim() || undefined }
            : {}),
        }),
      });
      await onUpdated();
      onClose();
      toast.success('Plan updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update plan');
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo() {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch(`/api/schedule/events?date=${encodeURIComponent(today)}`, {
        method: 'DELETE',
      });
      await onUpdated();
      onClose();
      toast.success('Plan restored');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to undo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Plan today">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="text-sm font-bold text-[var(--muted)]">Postpone</div>
          <div className="grid grid-cols-3 gap-2">
            {([1, 2, 3] as const).map((days) => (
              <Button
                key={days}
                variant="alt"
                disabled={busy}
                onClick={() => triggerEvent('postpone', days)}
              >
                +{days}d
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-sm font-bold text-[var(--muted)]">Jolly day</div>
          <input
            type="text"
            maxLength={60}
            value={jollyLabel}
            onChange={(e) => setJollyLabel(e.target.value)}
            placeholder="Label (optional)"
            className="nb-input"
          />
          <div
            className={`grid gap-2 ${
              isRestDay ? 'grid-cols-1' : 'grid-cols-2'
            }`}
          >
            <Button
              variant="blue"
              disabled={busy}
              onClick={() => triggerEvent('jolly_extra')}
            >
              <Sparkles className="h-4 w-4" />
              Extra
            </Button>
            {!isRestDay && (
              <Button
                variant="blue"
                disabled={busy}
                onClick={() => triggerEvent('jolly_instead')}
              >
                <Sparkles className="h-4 w-4" />
                Instead
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="alt"
            disabled={busy}
            onClick={() => triggerEvent('skip')}
          >
            <SkipForward className="h-4 w-4" />
            Skip
          </Button>

          <Button
            variant="red"
            disabled={busy}
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              void triggerEvent('reset');
            }}
          >
            <RotateCcw className="h-4 w-4" />
            {confirmReset ? 'Confirm reset' : 'Reset'}
          </Button>
        </div>

        {hasTodayEvents && (
          <Button
            variant="alt"
            className="w-full"
            disabled={busy}
            onClick={handleUndo}
          >
            <Undo2 className="h-4 w-4" />
            Undo today
          </Button>
        )}
      </div>
    </Sheet>
  );
}
