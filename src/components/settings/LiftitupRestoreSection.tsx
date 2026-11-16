'use client';

import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  FileUp,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { ApiClientError, Button, Sheet, toast } from '@/components/ui';
import { TRACKING_TYPES } from '@/lib/ai/importSchema';
import {
  MAX_IMPORT_BYTES,
  REPLACE_CONFIRMATION_WORD,
  type LiftitupApplyResult,
  type LiftitupRestorePreview,
  type LiftitupRestoreValidationError,
  type LiftitupValidateResult,
  type RestoreMode,
  type UnmatchedExerciseResolution,
} from '@/lib/imports/constants';
import type { TrackingType, UserProfile } from '@/types/domain';

interface LiftitupRestoreSectionProps {
  onUserUpdated: (user: UserProfile) => void;
}

const TRACKING_LABELS: Record<TrackingType, string> = {
  weight_reps: 'Weight × Reps',
  bodyweight_reps: 'Bodyweight Reps',
  weighted_bodyweight: 'Weighted Bodyweight',
  assisted_bodyweight: 'Assisted Bodyweight',
  time: 'Time',
  weight_time: 'Weight + Time',
  distance: 'Distance',
  distance_time: 'Distance + Time',
};

export function LiftitupRestoreSection({
  onUserUpdated,
}: LiftitupRestoreSectionProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<LiftitupRestorePreview | null>(null);
  const [errors, setErrors] = useState<LiftitupRestoreValidationError[]>([]);
  const [resolutions, setResolutions] = useState<
    Record<string, UnmatchedExerciseResolution>
  >({});
  const [result, setResult] = useState<LiftitupApplyResult | null>(null);
  const [replaceSheetOpen, setReplaceSheetOpen] = useState(false);
  const [confirmWord, setConfirmWord] = useState('');

  async function callImportApi<T>(payload: {
    action: 'validate' | 'confirm';
    mode: RestoreMode;
    rawText: string;
    confirmation?: string;
    exerciseResolutions?: Record<string, UnmatchedExerciseResolution>;
  }): Promise<T> {
    const useFormData = new Blob([payload.rawText]).size > 4 * 1024 * 1024;
    let fetchInit: RequestInit;
    if (useFormData) {
      const fd = new FormData();
      fd.append('action', payload.action);
      fd.append('mode', payload.mode);
      fd.append('rawText', payload.rawText);
      if (payload.confirmation !== undefined) {
        fd.append('confirmation', payload.confirmation);
      }
      if (payload.exerciseResolutions !== undefined) {
        fd.append(
          'exerciseResolutions',
          JSON.stringify(payload.exerciseResolutions),
        );
      }
      fetchInit = {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      };
    } else {
      fetchInit = {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      };
    }

    const res = await fetch('/api/imports/liftitup', fetchInit);

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = undefined;
      }
    }

    if (!res.ok) {
      const errObj =
        parsed && typeof parsed === 'object'
          ? (parsed as {
              error?: { code?: string; message?: string; details?: unknown };
              requestId?: string;
            })
          : undefined;
      throw new ApiClientError(
        errObj?.error?.message || `Request failed (${res.status})`,
        res.status,
        errObj?.error?.code || `HTTP_${res.status}`,
        errObj?.requestId,
        errObj?.error?.details,
      );
    }

    return parsed as T;
  }

  function initResolutions(nextPreview: LiftitupRestorePreview) {
    const next: Record<string, UnmatchedExerciseResolution> = {};
    for (const item of nextPreview.unmatchedExercises) {
      next[item.key] = {
        action: 'create_custom',
        name: item.name,
        trackingType: item.suggestedTrackingType,
      };
    }
    setResolutions(next);
  }

  async function runValidate(text: string, targetMode: RestoreMode) {
    const trimmed = text.trim();
    if (!trimmed) {
      setPreview(null);
      setErrors([]);
      return;
    }

    if (new Blob([text]).size > MAX_IMPORT_BYTES) {
      setPreview(null);
      setErrors([
        { path: 'root', message: 'Import file exceeds 8 MB limit.' },
      ]);
      return;
    }

    setValidating(true);
    setResult(null);
    try {
      const res = await callImportApi<LiftitupValidateResult>({
        action: 'validate',
        mode: targetMode,
        rawText: text,
      });
      if (res.valid && res.preview) {
        setPreview(res.preview);
        setErrors([]);
        initResolutions(res.preview);
      } else {
        setPreview(null);
        setErrors(res.errors ?? []);
      }
    } catch (err) {
      setPreview(null);
      if (err instanceof ApiClientError) {
        const details = err.details as
          | { errors?: LiftitupRestoreValidationError[] }
          | undefined;
        if (Array.isArray(details?.errors) && details.errors.length > 0) {
          setErrors(details.errors);
        } else {
          setErrors([{ path: 'root', message: err.message }]);
        }
      } else {
        setErrors([
          {
            path: 'root',
            message: err instanceof Error ? err.message : 'Validation failed',
          },
        ]);
      }
    } finally {
      setValidating(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > MAX_IMPORT_BYTES) {
      setFileName(file.name);
      setRawText('');
      setPreview(null);
      setResult(null);
      setErrors([
        {
          path: 'root',
          message: `File "${file.name}" is larger than the 8 MB limit.`,
        },
      ]);
      return;
    }

    try {
      const content = await file.text();
      setFileName(file.name);
      setRawText(content);
      await runValidate(content, mode);
    } catch {
      toast.error('Failed to read selected file');
    }
  }

  function handleModeChange(nextMode: RestoreMode) {
    setMode(nextMode);
    setResult(null);
    if (rawText.trim()) {
      void runValidate(rawText, nextMode);
    }
  }

  function handleClear() {
    setRawText('');
    setFileName(null);
    setPreview(null);
    setErrors([]);
    setResolutions({});
    setResult(null);
    setConfirmWord('');
  }

  const allUnmatchedResolved =
    preview !== null &&
    preview.unmatchedExercises.every((u) => {
      const res = resolutions[u.key];
      if (!res) return false;
      if (res.action === 'map') return Boolean(res.targetExerciseId);
      return Boolean(res.trackingType);
    });

  async function executeRestore(confirmation?: string) {
    if (!preview || !allUnmatchedResolved || confirming) return;
    setConfirming(true);
    try {
      const applied = await callImportApi<LiftitupApplyResult>({
        action: 'confirm',
        mode,
        rawText,
        confirmation,
        exerciseResolutions: resolutions,
      });
      setResult(applied);
      setPreview(null);
      setReplaceSheetOpen(false);
      setConfirmWord('');
      onUserUpdated(applied.user);
      window.dispatchEvent(new Event('liftitup:user-updated'));
      toast.success(
        applied.mode === 'replace'
          ? 'Account restored from backup'
          : `Merged ${applied.sessionsCreated} session(s)`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setConfirming(false);
    }
  }

  function handlePrimaryConfirmClick() {
    if (!preview || !allUnmatchedResolved) return;
    if (mode === 'replace') {
      setConfirmWord('');
      setReplaceSheetOpen(true);
      return;
    }
    void executeRestore();
  }

  const replaceConfirmed =
    confirmWord.trim().toUpperCase() === REPLACE_CONFIRMATION_WORD;

  return (
    <section id="restore" className="card flex flex-col gap-3">
      <div>
        <h2 className="font-marker text-lg text-[var(--ink)]">
          Restore from Liftitup JSON
        </h2>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Upload or paste a Liftitup JSON export (max 8 MB). Covers workouts,
          active split, custom exercises, body metrics, and settings. Photos are
          not touched.
        </p>
      </div>

      {/* Mode Selector */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => handleModeChange('merge')}
          aria-pressed={mode === 'merge'}
          className={`flex min-h-[44px] flex-col items-start rounded-xl border-2 p-3 text-left transition ${
            mode === 'merge'
              ? 'border-[var(--line)] bg-[var(--gold-bg)] shadow-[2px_2px_0_var(--shadow-color)]'
              : 'border-[var(--line)]/40 bg-[var(--surface)]'
          }`}
        >
          <span className="font-marker text-base text-[var(--ink)]">
            Merge (default)
          </span>
          <span className="text-xs text-[var(--muted)]">
            Keep existing records, add missing sessions &amp; metrics. Keeps
            current active split if one exists.
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleModeChange('replace')}
          aria-pressed={mode === 'replace'}
          className={`flex min-h-[44px] flex-col items-start rounded-xl border-2 p-3 text-left transition ${
            mode === 'replace'
              ? 'border-[var(--red)] bg-[var(--red-bg)] shadow-[2px_2px_0_var(--shadow-color)]'
              : 'border-[var(--line)]/40 bg-[var(--surface)]'
          }`}
        >
          <span className="font-marker text-base text-[var(--red)]">
            Replace account data
          </span>
          <span className="text-xs text-[var(--muted)]">
            Wipes current workouts, splits, body metrics &amp; custom exercises,
            then restores the file.
          </span>
        </button>
      </div>

      {/* Upload / Paste Controls */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileChange}
        className="hidden"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="alt"
          onClick={() => fileInputRef.current?.click()}
          className="min-h-[44px] flex-1 justify-center gap-2"
        >
          <FileUp className="h-4 w-4" />
          <span>{fileName ? `File: ${fileName}` : 'Upload .json file'}</span>
        </Button>

        {(rawText || fileName || errors.length > 0 || result) && (
          <Button
            variant="alt"
            size="icon"
            aria-label="Clear restore input"
            onClick={handleClear}
            className="min-h-[44px] min-w-[44px]"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <textarea
        value={rawText}
        onChange={(e) => {
          setRawText(e.target.value);
          setFileName(null);
          setPreview(null);
          setErrors([]);
          setResult(null);
        }}
        placeholder="Or paste Liftitup JSON export here…"
        aria-label="Liftitup JSON export content"
        rows={4}
        spellCheck={false}
        className="w-full rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-3 text-base text-[var(--ink)] focus:outline-none"
      />

      <Button
        variant="primary"
        loading={validating}
        disabled={!rawText.trim() || validating}
        onClick={() => void runValidate(rawText, mode)}
        className="min-h-[44px] w-full justify-center gap-2"
      >
        <RefreshCw className="h-4 w-4" />
        <span>Validate &amp; Preview</span>
      </Button>

      {/* Validation Errors */}
      {errors.length > 0 && (
        <div
          role="alert"
          className="card-sm flex flex-col gap-1.5 border-[var(--red)] bg-[var(--red-bg)]"
        >
          <div className="flex items-center gap-2 font-marker text-base text-[var(--red)]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Cannot restore file</span>
          </div>
          <ul className="space-y-1 text-sm text-[var(--ink)]">
            {errors.slice(0, 10).map((err, idx) => (
              <li key={`${err.path}-${idx}`} className="break-words">
                <code className="rounded bg-[var(--card)] px-1 py-0.5 font-mono text-xs">
                  {err.path}
                </code>{' '}
                {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="flex flex-col gap-3 rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-marker text-base text-[var(--ink)]">
              Restore Preview ({preview.mode === 'replace' ? 'Replace' : 'Merge'})
            </span>
            <span className="pill text-xs">Unit: {preview.unit}</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--line)]/25 bg-[var(--card)] p-2">
              <div className="text-xs text-[var(--muted)]">Sessions</div>
              <div className="font-bold text-[var(--ink)]">
                {preview.sessionsCount}
              </div>
              {preview.dateRange && (
                <div className="text-xs text-[var(--muted)]">
                  {preview.dateRange.from} – {preview.dateRange.to}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-[var(--line)]/25 bg-[var(--card)] p-2">
              <div className="text-xs text-[var(--muted)]">Exercises</div>
              <div className="font-bold text-[var(--ink)]">
                {preview.exercisesMatchedCount} matched
              </div>
              <div className="text-xs text-[var(--muted)]">
                {preview.customExercisesFromExport.length} custom in file
              </div>
            </div>

            <div className="rounded-lg border border-[var(--line)]/25 bg-[var(--card)] p-2">
              <div className="text-xs text-[var(--muted)]">Body &amp; Prefs</div>
              <div className="font-bold text-[var(--ink)]">
                {preview.bodyMetricsCount} weights
              </div>
              <div className="text-xs text-[var(--muted)]">
                {preview.exerciseStepPrefsCount} step prefs ·{' '}
                {preview.hiddenExercisesCount} hidden
              </div>
            </div>
          </div>

          {preview.activeScheduleSummary && (
            <div className="rounded-lg border border-[var(--line)]/25 bg-[var(--card)] p-2.5 text-sm">
              <div className="font-bold text-[var(--ink)]">
                Active split: {preview.activeScheduleSummary.name}
              </div>
              <div className="text-xs text-[var(--muted)]">
                {preview.activeScheduleSummary.daysCount} day(s) ·{' '}
                {preview.activeScheduleSummary.eventsCount} schedule event(s)
                {preview.activeScheduleSummary.willKeepExisting
                  ? ' — will keep your existing active split'
                  : ''}
              </div>
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg border-2 border-[var(--line)]/40 bg-[var(--gold-bg)] p-2.5 text-sm text-[var(--ink)]">
              {preview.warnings.map((w, idx) => (
                <p key={idx} className="break-words">
                  {w}
                </p>
              ))}
            </div>
          )}

          {/* Unmatched Exercise Resolution */}
          {preview.unmatchedExercises.length > 0 && (
            <div className="flex flex-col gap-2.5 rounded-xl border-2 border-[var(--line)] bg-[var(--gold-bg)] p-3">
              <div className="flex items-center gap-2 font-marker text-base text-[var(--ink)]">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  {preview.unmatchedExercises.length} unmatched exercise(s)
                </span>
              </div>
              <p className="text-xs text-[var(--ink)]">
                Choose whether to map each unmatched exercise to an existing
                exercise or create it as a new custom exercise.
              </p>

              {preview.unmatchedExercises.map((item) => {
                const res = resolutions[item.key] ?? {
                  action: 'create_custom' as const,
                  name: item.name,
                  trackingType: item.suggestedTrackingType,
                };
                return (
                  <div
                    key={item.key}
                    className="flex flex-col gap-2 rounded-lg border border-[var(--line)]/40 bg-[var(--card)] p-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-sm font-bold text-[var(--ink)]">
                        {item.name}
                      </span>
                      <span className="text-xs text-[var(--muted)]">
                        {item.occurrences} reference(s)
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setResolutions((prev) => ({
                            ...prev,
                            [item.key]: {
                              action: 'create_custom',
                              name: item.name,
                              trackingType: item.suggestedTrackingType,
                            },
                          }))
                        }
                        className={`min-h-[44px] rounded-lg border-2 px-2 text-sm font-bold ${
                          res.action === 'create_custom'
                            ? 'border-[var(--line)] bg-[var(--gold-bg)] text-[var(--ink)]'
                            : 'border-[var(--line)]/30 bg-[var(--surface)] text-[var(--muted)]'
                        }`}
                      >
                        Create custom
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setResolutions((prev) => ({
                            ...prev,
                            [item.key]: {
                              action: 'map',
                              targetExerciseId:
                                preview.availableExercises[0]?.id ?? '',
                            },
                          }))
                        }
                        className={`min-h-[44px] rounded-lg border-2 px-2 text-sm font-bold ${
                          res.action === 'map'
                            ? 'border-[var(--line)] bg-[var(--gold-bg)] text-[var(--ink)]'
                            : 'border-[var(--line)]/30 bg-[var(--surface)] text-[var(--muted)]'
                        }`}
                      >
                        Map to existing
                      </button>
                    </div>

                    {res.action === 'create_custom' ? (
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-[var(--muted)]">
                          Tracking type
                        </span>
                        <select
                          value={res.trackingType}
                          onChange={(e) =>
                            setResolutions((prev) => ({
                              ...prev,
                              [item.key]: {
                                action: 'create_custom',
                                name: item.name,
                                trackingType: e.target.value as TrackingType,
                              },
                            }))
                          }
                          className="min-h-[44px] w-full rounded-lg border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 text-base"
                        >
                          {TRACKING_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {TRACKING_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-[var(--muted)]">
                          Target exercise
                        </span>
                        <select
                          value={res.targetExerciseId}
                          onChange={(e) =>
                            setResolutions((prev) => ({
                              ...prev,
                              [item.key]: {
                                action: 'map',
                                targetExerciseId: e.target.value,
                              },
                            }))
                          }
                          className="min-h-[44px] w-full rounded-lg border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 text-base"
                        >
                          {preview.availableExercises.map((ex) => (
                            <option key={ex.id} value={ex.id}>
                              {ex.name}
                              {ex.isCustom ? ' (Custom)' : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <Button
            variant={mode === 'replace' ? 'red' : 'green'}
            size="big"
            loading={confirming}
            disabled={!allUnmatchedResolved || confirming}
            onClick={handlePrimaryConfirmClick}
            className="min-h-[44px] w-full justify-center gap-2"
          >
            <Check className="h-5 w-5" />
            <span>
              {mode === 'replace'
                ? 'Replace account data…'
                : 'Restore (Merge)'}
            </span>
          </Button>
        </div>
      )}

      {/* Result Screen */}
      {result && (
        <div
          aria-live="polite"
          className="flex flex-col gap-2.5 rounded-xl border-2 border-[var(--line)] bg-[var(--green-bg)] p-3 text-sm text-[var(--ink)]"
        >
          <div className="flex items-center gap-2 font-marker text-base">
            <Check className="h-5 w-5 shrink-0" />
            <span>
              Restore complete ({result.mode === 'replace' ? 'Replace' : 'Merge'})
            </span>
          </div>
          <ul className="space-y-0.5">
            <li>
              Sessions created: <strong>{result.sessionsCreated}</strong> (skipped
              duplicates: <strong>{result.sessionsSkipped}</strong>)
            </li>
            <li>
              Body metrics created: <strong>{result.bodyMetricsCreated}</strong>{' '}
              (skipped: <strong>{result.bodyMetricsSkipped}</strong>)
            </li>
            <li>
              Custom exercises created:{' '}
              <strong>{result.customExercisesCreated}</strong> (reused:{' '}
              <strong>{result.customExercisesReused}</strong>)
            </li>
            <li>
              Active split:{' '}
              <strong>
                {result.splitRestored
                  ? `Restored (${result.scheduleEventsCreated} event(s))`
                  : result.splitKeptExisting
                    ? 'Kept existing active split'
                    : 'None in export'}
              </strong>
            </li>
            <li>
              Preferences: <strong>{result.exerciseStepPrefsApplied}</strong>{' '}
              weight step(s), <strong>{result.hiddenExercisesApplied}</strong>{' '}
              hidden exercise(s)
            </li>
          </ul>

          {result.skippedItems.length > 0 && (
            <div className="rounded-lg border border-[var(--line)]/30 bg-[var(--card)] p-2 text-xs">
              <div className="font-bold">Skipped items</div>
              <ul className="mt-1 space-y-0.5 text-[var(--muted)]">
                {result.skippedItems.slice(0, 10).map((s, idx) => (
                  <li key={idx}>
                    <strong>{s.item}:</strong> {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Replace Confirmation Sheet */}
      <Sheet
        open={replaceSheetOpen}
        onClose={() => {
          if (!confirming) setReplaceSheetOpen(false);
        }}
        title="Replace all account data?"
      >
        {preview && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (replaceConfirmed) {
                void executeRestore(confirmWord.trim());
              }
            }}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-2 rounded-xl border-2 border-[var(--red)] bg-[var(--red-bg)] p-3 text-sm text-[var(--ink)]">
              <div className="font-bold text-[var(--red)]">
                Will permanently delete:
              </div>
              <ul className="list-disc space-y-0.5 pl-4">
                {preview.replaceWarning.willDelete.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>

              <div className="mt-1 font-bold text-[var(--ink)]">
                Cannot be restored from this file:
              </div>
              <ul className="list-disc space-y-0.5 pl-4">
                {preview.replaceWarning.cannotRestore.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>

              <div className="mt-1 font-bold text-[var(--ink)]">Preserved:</div>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-[var(--muted)]">
                {preview.replaceWarning.preserves.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>

            <a
              href="/api/export?format=json"
              download
              className="btn alt min-h-[44px] w-full justify-center gap-2 no-underline"
            >
              <Download className="h-4 w-4" />
              Download fresh JSON export first
            </a>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-bold text-[var(--ink)]">
                Type{' '}
                <code className="rounded bg-[var(--surface-alt)] px-1.5 py-0.5 font-mono">
                  {REPLACE_CONFIRMATION_WORD}
                </code>{' '}
                to confirm
              </span>
              <input
                type="text"
                value={confirmWord}
                onChange={(e) => setConfirmWord(e.target.value)}
                placeholder={REPLACE_CONFIRMATION_WORD}
                autoComplete="off"
                autoCapitalize="characters"
                className="min-h-[44px] rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 text-base"
              />
            </label>

            <div className="flex gap-2">
              <Button
                variant="alt"
                disabled={confirming}
                onClick={() => setReplaceSheetOpen(false)}
                className="min-h-[44px] flex-1 justify-center"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="red"
                loading={confirming}
                disabled={!replaceConfirmed || confirming}
                className="min-h-[44px] flex-1 justify-center"
              >
                Confirm Replace
              </Button>
            </div>
          </form>
        )}
      </Sheet>
    </section>
  );
}
