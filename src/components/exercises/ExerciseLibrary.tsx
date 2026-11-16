'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Pencil, Plus, Search, X } from 'lucide-react';
import { ApiClientError, apiFetch, Button, toast } from '@/components/ui';
import type { Exercise, TrackingType } from '@/types/domain';
import {
  CATEGORY_OPTIONS,
  TRACKING_TYPE_MAP,
  TRACKING_TYPE_OPTIONS,
} from './exerciseMeta';

interface ExercisesListResponse {
  exercises: Exercise[];
}

interface ExerciseUpdateResponse {
  exercise: Exercise;
}

export function ExerciseLibrary() {
  const router = useRouter();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('');
  const [trackingType, setTrackingType] = useState<TrackingType | ''>('');
  const [showHidden, setShowHidden] = useState(false);
  const [pendingHideId, setPendingHideId] = useState<string | null>(null);

  const loadExercises = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch<ExercisesListResponse>(
        '/api/exercises?includeHidden=1',
      );
      setExercises(data.exercises);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.replace('/welcome');
        return;
      }
      toast.error(
        err instanceof Error ? err.message : 'Failed to load exercises',
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadExercises();
  }, [loadExercises]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter((ex) => {
      if (!showHidden && ex.isHidden) return false;
      if (category && ex.category !== category) return false;
      if (trackingType && ex.trackingType !== trackingType) return false;
      if (q) {
        const nameMatch = ex.name.toLowerCase().includes(q);
        const aliasMatch = ex.aliases.some((a) => a.toLowerCase().includes(q));
        if (!nameMatch && !aliasMatch) return false;
      }
      return true;
    });
  }, [exercises, showHidden, category, trackingType, query]);

  const hiddenCount = useMemo(
    () => exercises.filter((ex) => ex.isHidden).length,
    [exercises],
  );

  async function toggleHidden(ex: Exercise) {
    const nextHidden = !ex.isHidden;
    setPendingHideId(ex.id);
    try {
      const data = await apiFetch<ExerciseUpdateResponse>(
        `/api/exercises/${ex.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ hidden: nextHidden }),
        },
      );
      setExercises((prev) =>
        prev.map((item) => (item.id === ex.id ? data.exercise : item)),
      );
      toast.success(nextHidden ? 'Exercise hidden' : 'Exercise visible');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.replace('/welcome');
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setPendingHideId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 pb-28 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-marker text-2xl text-[var(--ink)]">Exercises</h1>
        <Link href="/exercises/new" className="btn">
          <Plus className="h-5 w-5" />
          <span>New</span>
        </Link>
      </div>

      {/* Search */}
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3.5 h-5 w-5 text-[var(--muted)]" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises"
          aria-label="Search exercises"
          className="min-h-[44px] w-full rounded-[6px] border-[3px] border-[var(--line)] bg-[var(--card)] py-2 pl-10 pr-11 text-base text-[var(--ink)] shadow-[3px_3px_0_var(--shadow-color)] outline-none focus:bg-[var(--surface)]"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-1 flex h-11 w-11 items-center justify-center rounded-md text-[var(--muted)]"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Compact category filter chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setCategory('')}
          className={`chip min-h-[44px] shrink-0 rounded-full border-[2.5px] border-[var(--line)] px-3.5 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${
            category === ''
              ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
              : 'bg-[var(--card)] text-[var(--ink)]'
          }`}
        >
          All
        </button>
        {CATEGORY_OPTIONS.map((cat) => (
          <button
            key={cat.value}
            type="button"
            onClick={() =>
              setCategory((prev) => (prev === cat.value ? '' : cat.value))
            }
            className={`chip min-h-[44px] shrink-0 rounded-full border-[2.5px] border-[var(--line)] px-3.5 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${
              category === cat.value
                ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                : 'bg-[var(--card)] text-[var(--ink)]'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Compact tracking type filter chips + show hidden toggle */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setShowHidden((prev) => !prev)}
          aria-pressed={showHidden}
          className={`chip flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border-[2.5px] border-[var(--line)] px-3.5 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${
            showHidden
              ? 'bg-[var(--blue-bg)] text-[var(--ink)]'
              : 'bg-[var(--card)] text-[var(--ink)]'
          }`}
        >
          {showHidden ? (
            <Eye className="h-4 w-4" />
          ) : (
            <EyeOff className="h-4 w-4" />
          )}
          <span>Show hidden{hiddenCount > 0 ? ` (${hiddenCount})` : ''}</span>
        </button>

        {TRACKING_TYPE_OPTIONS.map((tt) => {
          const Icon = tt.Icon;
          const active = trackingType === tt.value;
          return (
            <button
              key={tt.value}
              type="button"
              onClick={() =>
                setTrackingType((prev) => (prev === tt.value ? '' : tt.value))
              }
              className={`chip flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border-[2.5px] border-[var(--line)] px-3 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${
                active
                  ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                  : 'bg-[var(--card)] text-[var(--ink)]'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{tt.label}</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="card-sm text-center text-[var(--muted)]">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card-sm text-center text-[var(--muted)]">
          No exercises found
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((ex) => {
            const meta = TRACKING_TYPE_MAP[ex.trackingType];
            const Icon = meta?.Icon;
            return (
              <li
                key={ex.id}
                className={`card-sm flex items-center justify-between gap-2 ${
                  ex.isHidden ? 'opacity-65' : ''
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  {Icon && (
                    <span
                      title={meta.label}
                      aria-label={meta.label}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 border-[var(--line)] bg-[var(--paper)]"
                    >
                      <Icon className="h-4 w-4 text-[var(--ink)]" />
                    </span>
                  )}
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <span className="truncate font-bold text-[var(--ink)]">
                      {ex.name}
                    </span>
                    {ex.isCustom && (
                      <span className="pill gold text-xs">Custom</span>
                    )}
                    {ex.isHidden && (
                      <span className="pill text-xs">Hidden</span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {ex.isCustom && (
                    <Link
                      href={`/exercises/${ex.id}/edit`}
                      aria-label={`Edit ${ex.name}`}
                      className="btn alt icon"
                    >
                      <Pencil className="h-4 w-4" />
                    </Link>
                  )}
                  <Button
                    variant="alt"
                    size="icon"
                    loading={pendingHideId === ex.id}
                    onClick={() => void toggleHidden(ex)}
                    aria-label={
                      ex.isHidden ? `Unhide ${ex.name}` : `Hide ${ex.name}`
                    }
                    title={ex.isHidden ? 'Unhide' : 'Hide'}
                  >
                    {ex.isHidden ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
