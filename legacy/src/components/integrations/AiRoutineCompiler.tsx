'use client';

import React, { useState, useMemo } from 'react';
import type {
  AnalyticsSummary,
  ExerciseDefinition,
  Schedule,
  UserProfile,
} from '@/types/domain';
import {
  buildAiCompilerPrompt,
  parseAndValidateAiPayload,
  SAMPLE_AI_PAYLOADS,
  type SampleAiPayloadPreset,
} from '@/lib/mcp/compilerSchema';
import {
  Bot,
  Copy,
  Check,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Wand2,
  Eye,
  EyeOff,
  Calendar,
  Dumbbell,
  RefreshCw,
} from 'lucide-react';

export interface AiRoutineCompilerProps {
  user: UserProfile;
  schedule: Schedule | null;
  analytics: AnalyticsSummary | null;
  exercises: ExerciseDefinition[];
  onRefresh: () => Promise<void>;
  onShowToast: (message: string) => void;
}

export default function AiRoutineCompiler({
  user,
  schedule,
  analytics,
  exercises,
  onRefresh,
  onShowToast,
}: AiRoutineCompilerProps) {
  const [customGoal, setCustomGoal] = useState<string>(
    'Build me a 4-day Upper/Lower hypertrophy split emphasizing lats and arms, alternating weighted chin-ups and pulley.'
  );
  const [targetMode, setTargetMode] = useState<'schedule' | 'workout_session'>(
    'schedule'
  );
  const [showPromptPreview, setShowPromptPreview] = useState<boolean>(false);
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);
  const [rawJsonInput, setRawJsonInput] = useState<string>(
    SAMPLE_AI_PAYLOADS[0].jsonString
  );
  const [activeSampleId, setActiveSampleId] = useState<string>(
    SAMPLE_AI_PAYLOADS[0].id
  );
  const [applying, setApplying] = useState<boolean>(false);

  const generatedPrompt = useMemo(
    () =>
      buildAiCompilerPrompt({
        user,
        schedule,
        analytics,
        exercises,
        customGoal,
        targetMode,
      }),
    [user, schedule, analytics, exercises, customGoal, targetMode]
  );

  const validation = useMemo(
    () => parseAndValidateAiPayload(rawJsonInput, exercises, schedule),
    [rawJsonInput, exercises, schedule]
  );

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      setCopiedPrompt(true);
      onShowToast('Copied AI System Prompt & JSON Schema to clipboard!');
      setTimeout(() => setCopiedPrompt(false), 2500);
    } catch {
      onShowToast('Failed to copy automatically — open preview to copy.');
      setShowPromptPreview(true);
    }
  };

  const handleLoadSample = (sample: SampleAiPayloadPreset) => {
    setActiveSampleId(sample.id);
    setTargetMode(sample.mode);
    setRawJsonInput(sample.jsonString);
    onShowToast(`Loaded sample: ${sample.title}`);
  };

  const handleApplyPayload = async () => {
    if (!validation.valid || !validation.payload) return;
    setApplying(true);
    try {
      const payload = validation.payload;

      if (payload.mode === 'schedule' && payload.schedule) {
        const res = await fetch('/api/schedule', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: payload.schedule.name,
            splitType: payload.schedule.splitType,
            days: payload.schedule.days,
            schedule: payload.schedule,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to update schedule');
        }

        await onRefresh();
        onShowToast(
          `Applied AI Schedule: "${payload.schedule.name}"!`
        );
      } else if (payload.mode === 'workout_session' && payload.workoutSession) {
        const nowIso = new Date().toISOString();
        const res = await fetch('/api/workouts/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            routineLabel: payload.workoutSession.routineLabel,
            durationMinutes: payload.workoutSession.durationMinutes || 55,
            notes: payload.workoutSession.notes,
            startedAt: nowIso,
            completedAt: nowIso,
            sets: payload.workoutSession.sets,
            session: payload.workoutSession,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to log AI workout session');
        }

        const data = await res.json().catch(() => ({}));
        await onRefresh();
        const xpEarned = data?.impact?.xpEarned || data?.session?.xpEarned || 250;
        onShowToast(
          `Logged AI Session "${payload.workoutSession.routineLabel}" (+${xpEarned} XP)!`
        );
      }
    } catch (err) {
      onShowToast(
        err instanceof Error ? err.message : 'Error applying AI payload'
      );
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Intro Hero Banner */}
      <div className="hero-card space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Bot className="w-6 h-6 text-[#1d1a16]" />
            <h2 className="text-xl font-marker">
              STRUCTURED AI ROUTINE &amp; SESSION COMPILER
            </h2>
          </div>
          <span className="pill blue text-xs">
            ChatGPT · Claude · Gemini
          </span>
        </div>
        <p className="text-base leading-snug">
          Brainstorm your split or today&apos;s workout with any LLM using your real{' '}
          <strong>{user.bodyweightKg}kg bodyweight</strong>,{' '}
          <strong>Pulley ↔ Weighted Chin-up equivalence</strong>, and top e1RMs—then
          paste the JSON back for a live Before → After diff!
        </p>
      </div>

      {/* STEP 1: Custom Hypertrophy Goal & Prompt Generator */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="pill gold font-marker">STEP 1</span>
            <h3 className="text-lg font-marker">
              CONFIGURE GOAL &amp; COPY AI PROMPT
            </h3>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTargetMode('schedule')}
              className={`btn !min-h-[38px] !px-3 !py-1 text-sm ${
                targetMode === 'schedule' ? '' : 'alt'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Weekly Split
            </button>
            <button
              type="button"
              onClick={() => setTargetMode('workout_session')}
              className={`btn !min-h-[38px] !px-3 !py-1 text-sm ${
                targetMode === 'workout_session' ? '' : 'alt'
              }`}
            >
              <Dumbbell className="w-4 h-4" />
              Single Session
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="ai-compiler-goal"
            className="block text-sm font-bold text-[#5d5446]"
          >
            Your Custom Hypertrophy Goal (embedded directly into the prompt):
          </label>
          <textarea
            id="ai-compiler-goal"
            rows={2}
            value={customGoal}
            onChange={(e) => setCustomGoal(e.target.value)}
            placeholder="e.g., Build me a 4-day Upper/Lower split emphasizing lats & arms, alternating weighted chin-ups and pulley..."
            className="nb-input resize-y"
          />
        </div>

        {/* Quick Goal Suggestion Chips */}
        <div className="flex flex-wrap gap-1.5">
          {[
            '4-day Upper/Lower emphasizing lats & arms (Chin-ups + Pulley)',
            '5-day Upper/Lower + PPL hitting 14–16 MAV sets for chest & back',
            'Joint-friendly cable & machine specialization split (low spinal fatigue)',
          ].map((presetGoal) => (
            <button
              key={presetGoal}
              type="button"
              onClick={() => setCustomGoal(presetGoal)}
              className="pill text-xs cursor-pointer hover:bg-[#fbedba] active:translate-y-0.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#d9412b]" />
              {presetGoal}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleCopyPrompt}
            className="btn flex-1 min-w-[220px]"
          >
            {copiedPrompt ? (
              <>
                <Check className="w-5 h-5 text-[#2e7d3a]" />
                Copied Prompt &amp; Schema!
              </>
            ) : (
              <>
                <Copy className="w-5 h-5" />
                📋 Copy AI Prompt &amp; Schema
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowPromptPreview((v) => !v)}
            className="btn alt"
          >
            {showPromptPreview ? (
              <>
                <EyeOff className="w-4 h-4" />
                Hide Prompt
              </>
            ) : (
              <>
                <Eye className="w-4 h-4" />
                Inspect Prompt
              </>
            )}
          </button>
        </div>

        {showPromptPreview && (
          <div className="card-sm bg-[#1d1a16] text-[#fbf5e4] overflow-x-auto max-h-60">
            <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">
              {generatedPrompt}
            </pre>
          </div>
        )}
      </section>

      {/* STEP 2: Paste AI Output or 1-Tap Sample Loaders */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="pill gold font-marker">STEP 2</span>
            <h3 className="text-lg font-marker">
              PASTE AI JSON OR TEST A SAMPLE IN 1 TAP
            </h3>
          </div>
          <span className="text-xs font-bold text-[#5d5446]">
            Auto-strips ```json fences &amp; fuzzy-matches slugs
          </span>
        </div>

        {/* 3 Sample AI Output Pills */}
        <div className="space-y-1.5">
          <div className="text-sm font-bold text-[#5d5446]">
            ⚡ Load Sample AI Output (1-Tap Instant Test):
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {SAMPLE_AI_PAYLOADS.map((sample) => {
              const isSelected = activeSampleId === sample.id;
              return (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => handleLoadSample(sample)}
                  className={`card-sm text-left transition-transform active:translate-y-0.5 cursor-pointer flex flex-col justify-between gap-1.5 ${
                    isSelected ? '!bg-[#fbedba] !border-[#d9412b]' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="pill text-xs gold">{sample.badge}</span>
                    <Wand2 className="w-4 h-4 text-[#2b5fa8] shrink-0" />
                  </div>
                  <div className="font-bold text-base leading-tight">
                    {sample.title}
                  </div>
                  <div className="text-xs text-[#5d5446] leading-snug">
                    {sample.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="ai-json-textarea"
            className="block text-sm font-bold text-[#5d5446]"
          >
            Paste LLM JSON Response (`ScheduleCompilePayload`):
          </label>
          <textarea
            id="ai-json-textarea"
            rows={7}
            value={rawJsonInput}
            onChange={(e) => {
              setRawJsonInput(e.target.value);
              setActiveSampleId('');
            }}
            placeholder='Paste JSON output from ChatGPT, Claude, or Gemini here (markdown ```json fences are stripped automatically)...'
            className="nb-input !font-mono !text-base resize-y"
          />
        </div>
      </section>

      {/* STEP 3: Live Validation Badge + Visual Before -> After Diff Preview */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="pill gold font-marker">STEP 3</span>
            <h3 className="text-lg font-marker">
              BEFORE → AFTER DIFF &amp; 1-TAP APPLY
            </h3>
          </div>

          {validation.valid ? (
            <span className="pill green text-sm">
              <CheckCircle2 className="w-4 h-4 text-[#2e7d3a]" />
              Valid{' '}
              {validation.payload?.mode === 'schedule'
                ? 'Schedule Split'
                : 'Session Log'}{' '}
              JSON
            </span>
          ) : (
            <span className="pill red text-sm">
              <AlertTriangle className="w-4 h-4 text-[#d9412b]" />
              Validation Error
            </span>
          )}
        </div>

        {/* Validation Errors */}
        {!validation.valid && validation.errors.length > 0 && (
          <div className="card-sm !bg-[#f6cfc4] space-y-1">
            {validation.errors.map((err, i) => (
              <div key={i} className="text-sm font-bold text-[#1d1a16]">
                • {err}
              </div>
            ))}
          </div>
        )}

        {/* Fuzzy-Match Resolutions & Warnings Sticky Note */}
        {(validation.resolutions.length > 0 ||
          validation.warnings.length > 0) && (
          <div className="note space-y-1 text-sm">
            <div className="font-marker text-sm">
              🧠 COMPILER SMART RESOLUTIONS:
            </div>
            {validation.resolutions.map((r, idx) => (
              <div key={idx}>• {r}</div>
            ))}
            {validation.warnings.map((w, idx) => (
              <div key={idx} className="text-[#d9412b]">
                • {w}
              </div>
            ))}
          </div>
        )}

        {/* Schedule Diff Preview */}
        {validation.valid &&
          validation.diff?.mode === 'schedule' &&
          validation.diff.scheduleDiff && (
            <div className="space-y-3">
              {/* Top KPI Summary Tiles */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="kpi ok">
                  <div className="text-xs font-bold uppercase text-[#5d5446]">
                    Split Program Name
                  </div>
                  <div className="text-xs line-through text-[#5d5446] truncate">
                    {validation.diff.scheduleDiff.beforeScheduleName}
                  </div>
                  <div className="font-marker text-base text-[#1d1a16] flex items-center gap-1">
                    <ArrowRight className="w-4 h-4 text-[#2e7d3a] shrink-0" />
                    <span className="truncate">
                      {validation.diff.scheduleDiff.afterScheduleName}
                    </span>
                  </div>
                </div>

                <div className="kpi ok">
                  <div className="text-xs font-bold uppercase text-[#5d5446]">
                    Training Days / Week
                  </div>
                  <div className="font-marker text-xl flex items-center gap-2">
                    <span className="text-[#5d5446]">
                      {validation.diff.scheduleDiff.beforeTrainingDays}d
                    </span>
                    <ArrowRight className="w-4 h-4 text-[#2e7d3a]" />
                    <span className="text-[#2e7d3a]">
                      {validation.diff.scheduleDiff.afterTrainingDays}d / wk
                    </span>
                  </div>
                </div>

                <div className="kpi ok">
                  <div className="text-xs font-bold uppercase text-[#5d5446]">
                    Weekly Working Sets
                  </div>
                  <div className="font-marker text-xl flex items-center gap-2">
                    <span className="text-[#5d5446]">
                      {validation.diff.scheduleDiff.beforeWeeklySets}
                    </span>
                    <ArrowRight className="w-4 h-4 text-[#2e7d3a]" />
                    <span className="text-[#2e7d3a]">
                      {validation.diff.scheduleDiff.afterWeeklySets} sets
                    </span>
                  </div>
                </div>
              </div>

              {/* 7-Day Schedule Diff Breakdown */}
              <div className="space-y-2">
                {validation.diff.scheduleDiff.dayDiffs.map((day) => (
                  <div
                    key={day.dayOfWeek}
                    className={`card-sm space-y-2 ${
                      day.isRestDayAfter ? 'opacity-75' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="pill text-xs font-marker">
                          {day.dayName.slice(0, 3).toUpperCase()}
                        </span>
                        <div className="text-sm">
                          <span className="text-[#5d5446] line-through mr-1.5">
                            {day.beforeLabel}
                          </span>
                          <ArrowRight className="inline w-3.5 h-3.5 mr-1 text-[#2e7d3a]" />
                          <strong className="text-base">
                            {day.afterLabel}
                          </strong>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {!day.isRestDayAfter && (
                          <span className="pill green text-xs">
                            {day.beforeSets} → {day.afterSets} sets
                          </span>
                        )}
                        {day.changeType === 'new_training' && (
                          <span className="pill gold text-xs">+NEW DAY</span>
                        )}
                      </div>
                    </div>

                    {!day.isRestDayAfter && day.slotChanges.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {day.slotChanges.map((slot) => (
                          <div
                            key={`${day.dayOfWeek}-${slot.slotIndex}-${slot.exerciseId}`}
                            className={`pill text-xs ${
                              slot.status === 'swapped'
                                ? 'blue'
                                : slot.status === 'added'
                                ? 'gold'
                                : ''
                            }`}
                          >
                            <span>
                              {slot.status === 'swapped' &&
                              slot.previousExerciseName
                                ? `${slot.previousExerciseName} → `
                                : ''}
                              <strong>{slot.exerciseName}</strong> (
                              {slot.targetSets}×{slot.repRange} @
                              {slot.targetRir}RIR)
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        {/* Session Log Diff Preview */}
        {validation.valid &&
          validation.diff?.mode === 'workout_session' &&
          validation.diff.sessionDiff && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="kpi ok">
                  <div className="text-xs font-bold uppercase text-[#5d5446]">
                    Compiled Session
                  </div>
                  <div className="font-marker text-base">
                    {validation.diff.sessionDiff.routineLabel}
                  </div>
                </div>
                <div className="kpi ok">
                  <div className="text-xs font-bold uppercase text-[#5d5446]">
                    Exercises &amp; Sets
                  </div>
                  <div className="font-marker text-xl text-[#2e7d3a]">
                    {validation.diff.sessionDiff.uniqueExercisesCount} Ex ·{' '}
                    {validation.diff.sessionDiff.totalSets} Sets
                  </div>
                </div>
                <div className="kpi ok">
                  <div className="text-xs font-bold uppercase text-[#5d5446]">
                    Est. Tonnage
                  </div>
                  <div className="font-marker text-xl text-[#1d1a16]">
                    ~{validation.diff.sessionDiff.estimatedVolumeKg.toLocaleString()}{' '}
                    kg
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                {validation.diff.sessionDiff.exerciseGroups.map((group) => (
                  <div
                    key={group.exerciseId}
                    className="card-sm flex items-center justify-between gap-2 flex-wrap"
                  >
                    <div>
                      <div className="font-bold text-base">
                        {group.exerciseName}
                      </div>
                      <div className="text-xs text-[#5d5446]">
                        Slot: {group.movementSlot} ·Slug: {group.exerciseId}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="pill green text-xs">
                        {group.setsCount} sets
                      </span>
                      <span className="pill gold text-xs">
                        Top: {group.topSetSummary}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        {/* Primary Action Button */}
        <button
          type="button"
          disabled={!validation.valid || applying}
          onClick={handleApplyPayload}
          className="btn big w-full"
        >
          {applying ? (
            <>
              <RefreshCw className="w-5 h-5 animate-spin" />
              Applying to LiftItUp...
            </>
          ) : validation.payload?.mode === 'workout_session' ? (
            <>
              ⚡ Log AI Session &amp; Claim XP (
              {validation.diff?.sessionDiff?.totalSets || 0} Sets)
            </>
          ) : (
            <>
              ⚡ Apply AI Schedule to My Weekly Split
            </>
          )}
        </button>
      </section>
    </div>
  );
}
