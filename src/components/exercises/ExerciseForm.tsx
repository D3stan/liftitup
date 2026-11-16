'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff, Trash2 } from 'lucide-react';
import {
  ApiClientError,
  apiFetch,
  Button,
  Sheet,
  toast,
} from '@/components/ui';
import type { Exercise, TrackingType, UserProfile, WeightUnit } from '@/types/domain';
import { trackingUsesWeight } from '@/components/workout/trackingFormat';
import {
  displayStepToKg,
  KG_WEIGHT_STEP_OPTIONS,
  LB_WEIGHT_STEP_OPTIONS,
  stepKgToDisplay,
} from '@/lib/workouts/stepSize';
import {
  CATEGORY_OPTIONS,
  EQUIPMENT_OPTIONS,
  TRACKING_TYPE_OPTIONS,
} from './exerciseMeta';

interface ExerciseFormProps {
  mode: 'create' | 'edit';
  exerciseId?: string;
}

interface ExerciseResponse {
  exercise: Exercise;
}

export function ExerciseForm({ mode, exerciseId }: ExerciseFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  const [referencedError, setReferencedError] = useState<string | null>(null);

  const [existing, setExisting] = useState<Exercise | null>(null);
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [name, setName] = useState('');
  const [trackingType, setTrackingType] = useState<TrackingType>('weight_reps');
  const [category, setCategory] = useState('push');
  const [equipment, setEquipment] = useState('barbell');
  const [defaultRestSeconds, setDefaultRestSeconds] = useState('120');
  const [weightStepKg, setWeightStepKg] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<{ user: UserProfile }>('/api/auth/me')
      .then((res) => {
        if (active && res.user?.unit) {
          setUnit(res.user.unit);
        }
      })
      .catch(() => {
        // Non-critical fallback to kg
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (mode !== 'edit' || !exerciseId) return;
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const data = await apiFetch<ExerciseResponse>(
          `/api/exercises/${exerciseId}`,
        );
        if (!active) return;
        const ex = data.exercise;
        setExisting(ex);
        setName(ex.name);
        setTrackingType(ex.trackingType);
        setCategory(ex.category || 'other');
        setEquipment(ex.equipment || 'other');
        setDefaultRestSeconds(String(ex.defaultRestSeconds ?? 120));
        setWeightStepKg(ex.weightStepKg ?? null);
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiClientError && err.status === 401) {
          router.replace('/welcome');
          return;
        }
        toast.error(
          err instanceof Error ? err.message : 'Failed to load exercise',
        );
        router.replace('/exercises');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [mode, exerciseId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Name is required');
      return;
    }

    const parsedRest = Number(defaultRestSeconds);
    if (
      !Number.isInteger(parsedRest) ||
      parsedRest < 0 ||
      parsedRest > 600
    ) {
      toast.error('Default rest must be 0–600 seconds');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: trimmedName,
        trackingType,
        category,
        equipment,
        defaultRestSeconds: parsedRest,
        weightStepKg: trackingUsesWeight(trackingType) ? weightStepKg : null,
      };

      if (mode === 'create') {
        await apiFetch<ExerciseResponse>('/api/exercises', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success('Exercise created');
      } else {
        await apiFetch<ExerciseResponse>(`/api/exercises/${exerciseId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast.success('Exercise saved');
      }
      router.push('/exercises');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.replace('/welcome');
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!exerciseId) return;
    setDeleting(true);
    setReferencedError(null);
    try {
      await apiFetch<{ ok: boolean }>(`/api/exercises/${exerciseId}`, {
        method: 'DELETE',
      });
      toast.success('Exercise deleted');
      setDeleteSheetOpen(false);
      router.push('/exercises');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.replace('/welcome');
        return;
      }
      if (err instanceof ApiClientError && err.status === 409) {
        setReferencedError(err.message);
        toast.error(err.message);
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  async function handleHideInstead() {
    if (!exerciseId) return;
    setHiding(true);
    try {
      const nextHidden = existing ? !existing.isHidden : true;
      const data = await apiFetch<ExerciseResponse>(
        `/api/exercises/${exerciseId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ hidden: nextHidden }),
        },
      );
      setExisting(data.exercise);
      toast.success(nextHidden ? 'Exercise hidden' : 'Exercise visible');
      setDeleteSheetOpen(false);
      router.push('/exercises');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.replace('/welcome');
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Hide failed');
    } finally {
      setHiding(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pb-28 pt-4">
        <div className="card-sm text-center text-[var(--muted)]">Loading…</div>
      </div>
    );
  }

  if (mode === 'edit' && existing && !existing.isCustom) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 pb-28 pt-4">
        <Link
          href="/exercises"
          className="inline-flex min-h-[44px] w-fit items-center gap-1.5 font-bold text-[var(--ink)]"
        >
          <ArrowLeft className="h-5 w-5" />
          <span>Exercises</span>
        </Link>
        <div className="card flex flex-col gap-3">
          <h1 className="font-marker text-2xl text-[var(--ink)]">
            {existing.name}
          </h1>
          <span className="pill w-fit">Built-in</span>
          <Button
            variant="alt"
            loading={hiding}
            onClick={() => void handleHideInstead()}
          >
            {existing.isHidden ? (
              <>
                <Eye className="h-5 w-5" />
                <span>Unhide</span>
              </>
            ) : (
              <>
                <EyeOff className="h-5 w-5" />
                <span>Hide</span>
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 pb-28 pt-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/exercises"
          className="inline-flex min-h-[44px] items-center gap-1.5 font-bold text-[var(--ink)]"
        >
          <ArrowLeft className="h-5 w-5" />
          <span>Exercises</span>
        </Link>
        <h1 className="font-marker text-2xl text-[var(--ink)]">
          {mode === 'create' ? 'New Exercise' : 'Edit Exercise'}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="card flex flex-col gap-4">
        {/* Name */}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Exercise name"
            maxLength={100}
            required
            className="min-h-[44px] w-full rounded-[6px] border-[3px] border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--ink)] outline-none"
          />
        </label>

        {/* Tracking type */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
            Tracking type
          </span>
          <div className="grid grid-cols-2 gap-2">
            {TRACKING_TYPE_OPTIONS.map((tt) => {
              const Icon = tt.Icon;
              const selected = trackingType === tt.value;
              return (
                <button
                  key={tt.value}
                  type="button"
                  onClick={() => setTrackingType(tt.value)}
                  aria-pressed={selected}
                  className={`flex min-h-[44px] items-center gap-2 rounded-[6px] border-[2.5px] border-[var(--line)] px-3 py-2 text-left text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${
                    selected
                      ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                      : 'bg-[var(--card)] text-[var(--ink)]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="leading-tight">{tt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Category */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
            Category
          </span>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_OPTIONS.map((cat) => {
              const selected = category === cat.value;
              return (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setCategory(cat.value)}
                  aria-pressed={selected}
                  className={`min-h-[44px] rounded-full border-[2.5px] border-[var(--line)] px-3.5 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${
                    selected
                      ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                      : 'bg-[var(--card)] text-[var(--ink)]'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Equipment */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
            Equipment
          </span>
          <div className="flex flex-wrap gap-1.5">
            {EQUIPMENT_OPTIONS.map((eq) => {
              const selected = equipment === eq.value;
              return (
                <button
                  key={eq.value}
                  type="button"
                  onClick={() => setEquipment(eq.value)}
                  aria-pressed={selected}
                  className={`min-h-[44px] rounded-full border-[2.5px] border-[var(--line)] px-3.5 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${
                    selected
                      ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                      : 'bg-[var(--card)] text-[var(--ink)]'
                  }`}
                >
                  {eq.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Default rest */}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
            Default rest (sec)
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={600}
            step={5}
            value={defaultRestSeconds}
            onChange={(e) => setDefaultRestSeconds(e.target.value)}
            className="min-h-[44px] w-32 rounded-[6px] border-[3px] border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--ink)] outline-none"
          />
        </label>

        {/* Weight step */}
        {(trackingUsesWeight(trackingType) || weightStepKg !== null) && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
              Weight step ({unit})
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setWeightStepKg(null)}
                aria-pressed={weightStepKg === null}
                className={`min-h-[44px] rounded-full border-[2.5px] border-[var(--line)] px-3.5 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${
                  weightStepKg === null
                    ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                    : 'bg-[var(--card)] text-[var(--ink)]'
                }`}
              >
                Global default
              </button>
              {(unit === 'lb'
                ? LB_WEIGHT_STEP_OPTIONS
                : KG_WEIGHT_STEP_OPTIONS
              ).map((option) => {
                const selected =
                  weightStepKg !== null &&
                  (unit === 'lb'
                    ? stepKgToDisplay(weightStepKg, 'lb') === option
                    : Math.abs(weightStepKg - option) < 0.001);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setWeightStepKg(displayStepToKg(option, unit))}
                    aria-pressed={selected}
                    className={`min-h-[44px] rounded-full border-[2.5px] border-[var(--line)] px-3.5 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${
                      selected
                        ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                        : 'bg-[var(--card)] text-[var(--ink)]'
                    }`}
                  >
                    ±{option} {unit}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          {mode === 'edit' ? (
            <Button
              variant="red"
              onClick={() => {
                setReferencedError(null);
                setDeleteSheetOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" />
              <span>Delete</span>
            </Button>
          ) : (
            <span />
          )}

          <Button type="submit" size="big" loading={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>

      <Sheet
        open={deleteSheetOpen}
        onClose={() => setDeleteSheetOpen(false)}
        title="Delete Exercise"
      >
        <div className="flex flex-col gap-3">
          {referencedError ? (
            <>
              <div className="rounded-[8px] border-[2.5px] border-[var(--line)] bg-[var(--red-bg)] p-3 text-base font-bold text-[var(--ink)]">
                {referencedError}
              </div>
              <Button
                variant="primary"
                loading={hiding}
                onClick={() => void handleHideInstead()}
              >
                <EyeOff className="h-4 w-4" />
                <span>Hide instead</span>
              </Button>
            </>
          ) : (
            <>
              <p className="font-bold text-[var(--ink)]">{name}</p>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="alt"
                  onClick={() => setDeleteSheetOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="red"
                  loading={deleting}
                  onClick={() => void handleDelete()}
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Confirm Delete</span>
                </Button>
              </div>
            </>
          )}
        </div>
      </Sheet>
    </div>
  );
}
