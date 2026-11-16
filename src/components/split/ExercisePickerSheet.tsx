'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Sheet, apiFetch, toast } from '@/components/ui';
import type { Exercise } from '@/types/domain';
import { TRACKING_TYPE_LABEL } from './formatTarget';

interface ExercisePickerSheetProps {
  open: boolean;
  onClose: () => void;
  onSelect: (exercise: Exercise) => void;
}

export function ExercisePickerSheet({
  open,
  onClose,
  onSelect,
}: ExercisePickerSheetProps) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open || exercises.length > 0) return;
    let active = true;
    setLoading(true);
    apiFetch<{ exercises: Exercise[] }>('/api/exercises')
      .then((data) => {
        if (active) {
          setExercises(data.exercises ?? []);
        }
      })
      .catch((err) => {
        if (active) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to load exercises',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, exercises.length]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return exercises.slice(0, 60);
    return exercises
      .filter(
        (ex) =>
          ex.name.toLowerCase().includes(q) ||
          ex.aliases.some((a) => a.toLowerCase().includes(q)),
      )
      .slice(0, 60);
  }, [exercises, query]);

  return (
    <Sheet open={open} onClose={onClose} title="Add exercise">
      <div className="space-y-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--muted)]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search exercises..."
            className="w-full min-h-[44px] rounded-[10px_14px_12px_10px] border-[3px] border-[var(--line)] bg-[var(--surface)] pl-10 pr-3 py-2 text-[17px] text-[var(--ink)] outline-none focus:bg-[var(--surface)]"
          />
        </div>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {loading ? (
            <p className="py-6 text-center text-[var(--muted)]">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-[var(--muted)]">No matches</p>
          ) : (
            filtered.map((ex) => (
              <button
                key={ex.id}
                type="button"
                onClick={() => {
                  onSelect(ex);
                  onClose();
                }}
                className="flex w-full min-h-[48px] items-center justify-between gap-2 rounded-[10px_12px_10px_12px] border-[2.5px] border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-left shadow-[2px_2px_0_var(--shadow-color)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
              >
                <span className="font-bold leading-snug text-[var(--ink)]">
                  {ex.name}
                </span>
                <span className="shrink-0 rounded border-[2px] border-[var(--line)] bg-[var(--surface-alt)] px-2 py-0.5 text-xs font-bold text-[var(--ink)]">
                  {TRACKING_TYPE_LABEL[ex.trackingType]}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </Sheet>
  );
}
