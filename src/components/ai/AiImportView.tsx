'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  ClipboardPaste,
  Copy,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { ApiClientError, apiFetch, Button, toast } from '@/components/ui';
import {
  AI_ONBOARDING_PROMPT,
  type AiImportPreview,
  type AiPreviewExercise,
  type AiValidationError,
} from '@/lib/ai/importSchema';

interface AiContextPayload {
  editPrompt: string;
}

interface ValidateApiResponse {
  valid: boolean;
  errors: AiValidationError[];
  preview: AiImportPreview | null;
}

interface ConfirmApiResponse extends ValidateApiResponse {
  createdCustomExercises?: Array<{ id: string; name: string }>;
}

function formatWeight(weightKg: number, unit: 'kg' | 'lb'): string {
  const val =
    unit === 'lb' ? Math.round(weightKg * 2.20462 * 10) / 10 : weightKg;
  return `${val} ${unit}`;
}

function formatExerciseTarget(ex: AiPreviewExercise, unit: 'kg' | 'lb'): string {
  const parts: string[] = [`${ex.targetSets}×`];
  if (ex.targetReps !== null) {
    parts[0] = `${ex.targetSets}×${ex.targetReps}`;
  } else if (ex.targetRepsMin !== null && ex.targetRepsMax !== null) {
    parts[0] = `${ex.targetSets}×${ex.targetRepsMin}-${ex.targetRepsMax}`;
  } else if (ex.targetTimeSeconds !== null) {
    parts[0] = `${ex.targetSets}×${ex.targetTimeSeconds}s`;
  } else if (ex.targetDistanceM !== null) {
    parts[0] = `${ex.targetSets}×${ex.targetDistanceM}m`;
  }

  if (ex.targetDistanceM !== null && ex.targetTimeSeconds !== null) {
    parts[0] = `${ex.targetSets}×${ex.targetDistanceM}m / ${ex.targetTimeSeconds}s`;
  }

  if (ex.targetWeightKg !== null) {
    parts.push(formatWeight(ex.targetWeightKg, unit));
  }

  parts.push(`${ex.restSeconds}s rest`);
  return parts.join(' · ');
}

export function AiImportView({ hideHeader = false }: { hideHeader?: boolean } = {}) {
  const router = useRouter();
  const [rawText, setRawText] = useState('');
  const [editPrompt, setEditPrompt] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<'onboarding' | 'edit' | null>(null);
  const [validating, setValidating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [validation, setValidation] = useState<ValidateApiResponse | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<AiContextPayload>('/api/ai/import')
      .then((data) => {
        if (active) setEditPrompt(data.editPrompt);
      })
      .catch((err) => {
        if (err instanceof ApiClientError && err.status === 401) return;
      });
    return () => {
      active = false;
    };
  }, []);

  const runValidate = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setValidation(null);
      setValidating(false);
      return;
    }

    setValidating(true);
    try {
      const res = await apiFetch<ValidateApiResponse>('/api/ai/import', {
        method: 'POST',
        body: JSON.stringify({ mode: 'validate', rawText: text }),
      });
      setValidation(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setValidating(false);
    }
  }, []);

  const handleTextChange = (next: string) => {
    setRawText(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!next.trim()) {
      setValidation(null);
      setValidating(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runValidate(next);
    }, 220);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const copyText = async (text: string, which: 'onboarding' | 'edit') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(which);
      toast.success(
        which === 'onboarding'
          ? 'Onboarding prompt copied'
          : 'Edit prompt copied',
      );
      setTimeout(() => {
        setCopiedKey((curr) => (curr === which ? null : curr));
      }, 2000);
    } catch {
      toast.error('Clipboard copy blocked');
    }
  };

  const handleCopyEditPrompt = async () => {
    if (editPrompt) {
      await copyText(editPrompt, 'edit');
      return;
    }
    try {
      const data = await apiFetch<AiContextPayload>('/api/ai/import');
      setEditPrompt(data.editPrompt);
      await copyText(data.editPrompt, 'edit');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load plan');
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        toast.info('Clipboard is empty');
        return;
      }
      setRawText(clip);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      await runValidate(clip);
    } catch {
      toast.error('Clipboard blocked — paste into box');
    }
  };

  const handleConfirmImport = async () => {
    if (!validation?.valid) return;
    setConfirming(true);
    try {
      const res = await apiFetch<ConfirmApiResponse>('/api/ai/import', {
        method: 'POST',
        body: JSON.stringify({ mode: 'confirm', rawText }),
      });
      window.dispatchEvent(new Event('liftitup:user-updated'));
      const customCount = res.createdCustomExercises?.length ?? 0;
      toast.success(
        customCount > 0
          ? `Imported (${customCount} custom)`
          : 'Plan imported',
      );
      router.push('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setConfirming(false);
    }
  };

  const hasInput = rawText.trim().length > 0;
  const preview = hasInput && validation?.valid ? validation.preview : null;
  const errors = hasInput && validation && !validation.valid ? validation.errors : [];

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        {!hideHeader && (
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[var(--ink)]" />
            <h1 className="font-marker text-2xl text-[var(--ink)]">AI Import</h1>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            variant="primary"
            onClick={() => void copyText(AI_ONBOARDING_PROMPT, 'onboarding')}
            className="w-full"
          >
            {copiedKey === 'onboarding' ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            <span>Copy onboarding prompt</span>
          </Button>

          <Button
            variant="alt"
            onClick={() => void handleCopyEditPrompt()}
            className="w-full"
          >
            {copiedKey === 'edit' ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            <span>Copy edit prompt</span>
          </Button>
        </div>
      </section>

      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="alt"
            onClick={() => void handlePasteClipboard()}
            className="flex-1"
          >
            <ClipboardPaste className="h-4 w-4" />
            <span>Paste AI result</span>
          </Button>

          {hasInput && (
            <Button
              variant="alt"
              size="icon"
              aria-label="Clear"
              onClick={() => {
                setRawText('');
                setValidation(null);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        <textarea
          value={rawText}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder="Paste JSON here"
          rows={6}
          spellCheck={false}
          className="w-full rounded-[8px] border-[3px] border-[var(--line)] bg-[var(--surface)] p-3 text-base font-bold text-[var(--ink)] shadow-[3px_3px_0_var(--shadow-color)] focus:outline-none"
        />

        {validating && (
          <div className="text-sm font-bold text-[var(--muted)]">Validating...</div>
        )}
      </section>

      {hasInput && errors.length > 0 && (
        <section
          role="alert"
          className="card-sm space-y-2 bg-[var(--red-bg)]"
        >
          <div className="flex items-center gap-2 font-marker text-lg text-[var(--ink)]">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>Validation errors</span>
          </div>
          <ul className="space-y-1 text-base font-bold text-[var(--ink)]">
            {errors.map((err, idx) => (
              <li key={`${err.path}-${idx}`} className="break-words">
                <code className="rounded bg-[var(--card)] px-1.5 py-0.5 text-sm">
                  {err.path}
                </code>{' '}
                {err.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {preview && (
        <section className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-marker text-xl text-[var(--ink)]">
              {preview.scheduleName}
            </h2>
            <div className="flex flex-wrap gap-1.5">
              <span className="pill">{preview.days.length} days</span>
              {preview.newCustomExercises.length > 0 && (
                <span className="pill gold">
                  +{preview.newCustomExercises.length} New custom
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 text-sm font-bold">
            <span className="pill">
              {formatWeight(preview.profile.weightKg, preview.profile.unit)}
            </span>
            {preview.profile.heightCm !== null && (
              <span className="pill">{preview.profile.heightCm} cm</span>
            )}
            {preview.profile.age !== null && (
              <span className="pill">{preview.profile.age} y</span>
            )}
            {preview.profile.trainingYears !== null && (
              <span className="pill">{preview.profile.trainingYears}y exp</span>
            )}
          </div>

          <div className="space-y-2">
            {preview.days.map((day, idx) => (
              <div
                key={`${day.label}-${idx}`}
                className="card-sm space-y-1.5 bg-[var(--card)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-marker text-base text-[var(--ink)]">
                    {idx + 1}. {day.label}
                  </span>
                  {day.isRestDay && <span className="pill">Rest</span>}
                </div>

                {!day.isRestDay && (
                  <ul className="space-y-1.5">
                    {day.exercises.map((ex, exIdx) => (
                      <li
                        key={`${ex.name}-${exIdx}`}
                        className="border-t border-dashed border-[var(--line)]/25 pt-1.5 first:border-t-0 first:pt-0"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="text-base font-bold text-[var(--ink)]">
                            {ex.matchedExerciseName ?? ex.name}
                          </span>
                          <div className="flex items-center gap-1">
                            {ex.isNewCustom && (
                              <span className="pill gold text-xs">
                                New custom
                              </span>
                            )}
                            <span className="text-xs font-bold text-[var(--muted)]">
                              {ex.resolvedTrackingType}
                            </span>
                          </div>
                        </div>
                        <div className="text-sm font-bold text-[var(--muted)]">
                          {formatExerciseTarget(ex, preview.profile.unit)}
                        </div>
                        {ex.notes && (
                          <div className="text-sm italic text-[var(--muted)]">
                            {ex.notes}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <Button
            variant="green"
            size="big"
            loading={confirming}
            onClick={() => void handleConfirmImport()}
            className="w-full"
          >
            <Check className="h-5 w-5" />
            <span>Confirm import</span>
          </Button>
        </section>
      )}
    </div>
  );
}
