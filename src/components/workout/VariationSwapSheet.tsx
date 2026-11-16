'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Search } from 'lucide-react';
import type { Exercise, ExercisePrefill, WeightUnit } from '@/types/domain';
import { apiFetch, Button, Sheet, toast } from '@/components/ui';
import {
  formatPrefillSummary,
  getTrackingShortLabel,
} from './trackingFormat';

export interface VariationSwapSheetProps {
  open: boolean;
  onClose: () => void;
  dateKey: string;
  unit: WeightUnit;
  currentExerciseId: string;
  currentExerciseName: string;
  scheduleDayExerciseId?: string | null;
  allowScheduleScope: boolean;
  exercises: Exercise[];
  prefillByExerciseId: Record<string, ExercisePrefill>;
  onSwapComplete: (
    toExercise: Exercise,
    prefill: ExercisePrefill | null,
    scope: 'session' | 'schedule',
  ) => void;
}

export default function VariationSwapSheet({
  open,
  onClose,
  dateKey,
  unit,
  currentExerciseId,
  currentExerciseName,
  scheduleDayExerciseId,
  allowScheduleScope,
  exercises,
  prefillByExerciseId,
  onSwapComplete,
}: VariationSwapSheetProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [loadedPrefill, setLoadedPrefill] =
    useState<Record<string, ExercisePrefill>>(prefillByExerciseId);
  const [submitting, setSubmitting] = useState<'session' | 'schedule' | null>(
    null,
  );

  useEffect(() => {
    setLoadedPrefill((prev) => ({ ...prev, ...prefillByExerciseId }));
  }, [prefillByExerciseId]);

  const currentEx = useMemo(
    () => exercises.find((e) => e.id === currentExerciseId) ?? null,
    [exercises, currentExerciseId],
  );

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = exercises.filter((ex) => {
      if (ex.id === currentExerciseId) return false;
      if (!q) return true;
      return (
        ex.name.toLowerCase().includes(q) ||
        ex.aliases.some((a) => a.toLowerCase().includes(q))
      );
    });

    const curCat = currentEx?.category;
    const curType = currentEx?.trackingType;
    return list.sort((a, b) => {
      const aScore =
        (a.category === curCat ? 2 : 0) + (a.trackingType === curType ? 1 : 0);
      const bScore =
        (b.category === curCat ? 2 : 0) + (b.trackingType === curType ? 1 : 0);
      if (aScore !== bScore) return bScore - aScore;
      return a.name.localeCompare(b.name);
    });
  }, [exercises, currentExerciseId, query, currentEx]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const first = candidates[0];
    setSelectedId(first ? first.id : '');
  }, [open, currentExerciseId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !selectedId || loadedPrefill[selectedId]) return;
    let active = true;
    apiFetch<{ prefillByExerciseId: Record<string, ExercisePrefill> }>(
      `/api/workouts/prefill?exerciseIds=${encodeURIComponent(selectedId)}&beforeDate=${encodeURIComponent(dateKey)}`,
    )
      .then((res) => {
        if (!active) return;
        setLoadedPrefill((prev) => ({
          ...prev,
          ...res.prefillByExerciseId,
        }));
      })
      .catch(() => {
        // Non-critical prefill lookup
      });
    return () => {
      active = false;
    };
  }, [open, selectedId, dateKey, loadedPrefill]);

  const selectedExercise = useMemo(
    () => exercises.find((e) => e.id === selectedId) ?? null,
    [exercises, selectedId],
  );

  const selectedPrefill = selectedExercise
    ? loadedPrefill[selectedExercise.id] ?? null
    : null;

  const selectedPrefillText = selectedExercise
    ? formatPrefillSummary(selectedPrefill, selectedExercise.trackingType, unit)
    : null;

  const handleConfirm = async (scope: 'session' | 'schedule') => {
    if (!selectedExercise) return;

    if (!allowScheduleScope || !scheduleDayExerciseId) {
      onSwapComplete(selectedExercise, selectedPrefill, 'session');
      onClose();
      return;
    }

    setSubmitting(scope);
    try {
      const res = await apiFetch<{
        ok: true;
        toExercise: Exercise;
        prefill: ExercisePrefill | null;
      }>('/api/workouts/swap', {
        method: 'POST',
        body: JSON.stringify({
          dateKey,
          scheduleDayExerciseId,
          toExerciseId: selectedExercise.id,
          scope,
        }),
      });
      toast.success(
        scope === 'schedule' ? 'Split updated' : 'Swapped for today',
      );
      onSwapComplete(res.toExercise, res.prefill, scope);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Swap failed');
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Swap Exercise">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-[var(--muted)]">
          <ArrowLeftRight className="h-4 w-4 shrink-0" />
          <span className="truncate">{currentExerciseName}</span>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search exercise..."
            className="min-h-[44px] w-full rounded-[8px] border-[2.5px] border-[var(--line)] bg-[var(--surface)] pl-9 pr-3 text-base font-bold outline-none"
          />
        </div>

        <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {candidates.slice(0, 60).map((ex) => {
            const isSelected = ex.id === selectedId;
            const prevSummary = formatPrefillSummary(
              loadedPrefill[ex.id],
              ex.trackingType,
              unit,
            );
            return (
              <button
                key={ex.id}
                type="button"
                onClick={() => setSelectedId(ex.id)}
                className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-[8px] border-[2.5px] border-[var(--line)] px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                    : 'bg-[var(--card)] text-[var(--ink)]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{ex.name}</div>
                  {prevSummary && (
                    <div
                      className={`text-xs font-bold ${
                        isSelected
                          ? 'text-[var(--btn-gold-fg)]/80'
                          : 'text-[var(--muted)]'
                      }`}
                    >
                      Last: {prevSummary}
                    </div>
                  )}
                </div>
                <span className="pill shrink-0 text-xs text-[var(--ink)]">
                  {getTrackingShortLabel(ex.trackingType)}
                </span>
              </button>
            );
          })}
          {candidates.length === 0 && (
            <p className="py-4 text-center text-base font-bold text-[var(--muted)]">
              No matches
            </p>
          )}
        </div>

        {selectedExercise && (
          <div className="rounded-[8px] border-[2.5px] border-[var(--line)] bg-[var(--gold-bg)] px-3 py-2 text-sm font-bold">
            <div className="truncate">{selectedExercise.name}</div>
            <div className="text-xs text-[var(--muted)]">
              {selectedPrefillText
                ? `Last logged: ${selectedPrefillText}`
                : 'No prior logs'}
            </div>
          </div>
        )}

        {allowScheduleScope && scheduleDayExerciseId ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="alt"
              loading={submitting === 'session'}
              disabled={!selectedExercise || submitting !== null}
              onClick={() => handleConfirm('session')}
            >
              This workout
            </Button>
            <Button
              variant="primary"
              loading={submitting === 'schedule'}
              disabled={!selectedExercise || submitting !== null}
              onClick={() => handleConfirm('schedule')}
            >
              Update split
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            className="w-full"
            disabled={!selectedExercise}
            onClick={() => handleConfirm('session')}
          >
            Swap
          </Button>
        )}
      </div>
    </Sheet>
  );
}
