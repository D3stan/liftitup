'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  Copy,
  FlaskConical,
  KeyRound,
  Upload,
  Watch,
} from 'lucide-react';
import { Button, apiFetch, toast } from '@/components/ui';
import { parseAppleHealthFileStrict } from '@/lib/integrations/appleHealthValidation';
import type {
  AppleHealthReceiveKind,
  AppleHealthWorkout,
  UserProfile,
} from '@/types/domain';

interface AppleFitnessPanelProps {
  user: UserProfile;
  onUserUpdated: (user: UserProfile) => void;
}

const DRY_RUN_TEMPLATE = JSON.stringify(
  {
    dryRun: true,
    workouts: [
      {
        workoutType: 'Traditional Strength Training',
        startedAt: '2026-11-16T09:00:00Z',
        durationMinutes: 45,
      },
    ],
  },
  null,
  2,
);

const WORKOUT_JSON_TEMPLATE = JSON.stringify(
  {
    workouts: [
      {
        workoutType: 'Traditional Strength Training',
        startedAt: '2026-11-16T09:00:00Z',
        durationMinutes: 52,
        activeCalories: 310,
        avgHeartRate: 136,
        maxHeartRate: 168,
        bodyweightKg: 75.4,
      },
    ],
  },
  null,
  2,
);

const WEIGHT_ONLY_JSON_TEMPLATE = JSON.stringify(
  {
    workouts: [
      {
        bodyweightKg: 75.4,
        measuredOn: '2026-11-16',
      },
    ],
  },
  null,
  2,
);

function formatLastReceivedTime(iso: string | null, timezone: string): string {
  if (!iso) return 'Never';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone || 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString();
  }
}

function formatKindLabel(kind: AppleHealthReceiveKind | null): string {
  if (kind === 'workout') return 'Workout';
  if (kind === 'weight') return 'Weight';
  if (kind === 'both') return 'Workout + Weight';
  return '—';
}

function formatLinkedLabel(
  kind: AppleHealthReceiveKind | null,
  linked: boolean | null,
): string {
  if (kind === 'weight' || linked === null) return 'N/A';
  return linked ? 'Linked to session' : 'Not linked yet';
}

export function AppleFitnessPanel({
  user,
  onUserUpdated,
}: AppleFitnessPanelProps) {
  const [workouts, setWorkouts] = useState<AppleHealthWorkout[]>([]);
  const [busy, setBusy] = useState(false);
  const [checkingFormat, setCheckingFormat] = useState(false);
  const [dryRunReply, setDryRunReply] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  const [lastReceived, setLastReceived] = useState<{
    at: string | null;
    kind: AppleHealthReceiveKind | null;
    linked: boolean | null;
  }>({
    at: user.appleHealthLastReceivedAt,
    kind: user.appleHealthLastReceivedKind,
    linked: user.appleHealthLastReceivedLinked,
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    setLastReceived({
      at: user.appleHealthLastReceivedAt,
      kind: user.appleHealthLastReceivedKind,
      linked: user.appleHealthLastReceivedLinked,
    });
  }, [
    user.appleHealthLastReceivedAt,
    user.appleHealthLastReceivedKind,
    user.appleHealthLastReceivedLinked,
  ]);

  const loadWorkouts = useCallback(async () => {
    try {
      const res = await apiFetch<{
        enabled: boolean;
        lastReceivedAt: string | null;
        lastReceivedKind: AppleHealthReceiveKind | null;
        lastReceivedLinked: boolean | null;
        workouts: AppleHealthWorkout[];
      }>('/api/integrations/apple-health');
      setWorkouts(res.workouts);
      setLastReceived({
        at: res.lastReceivedAt,
        kind: res.lastReceivedKind,
        linked: res.lastReceivedLinked,
      });
    } catch {
      // ignore initial load error if unauthenticated
    }
  }, []);

  useEffect(() => {
    void loadWorkouts();
  }, [loadWorkouts]);

  const webhookUrl = origin
    ? `${origin}/api/integrations/apple-health`
    : '/api/integrations/apple-health';

  async function copyText(id: string, value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      toast.success(`${label} copied`);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
    } catch {
      toast.error('Copy failed');
    }
  }

  async function handleToggle() {
    setBusy(true);
    try {
      const res = await apiFetch<{
        user: UserProfile;
        workouts: AppleHealthWorkout[];
      }>('/api/integrations/apple-health', {
        method: 'POST',
        body: JSON.stringify({
          action: 'toggle',
          enabled: !user.appleFitnessEnabled,
        }),
      });
      onUserUpdated(res.user);
      setWorkouts(res.workouts);
      toast.success(
        res.user.appleFitnessEnabled
          ? 'Apple Health enabled'
          : 'Apple Health paused',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckPayloadFormat() {
    setCheckingFormat(true);
    setDryRunReply(null);
    try {
      const res = await apiFetch<{
        ok: boolean;
        dryRun: boolean;
        message: string;
      }>('/api/integrations/apple-health', {
        method: 'POST',
        body: JSON.stringify({
          dryRun: true,
          workouts: [
            {
              workoutType: 'Traditional Strength Training',
              startedAt: new Date().toISOString(),
              durationMinutes: 45,
              activeCalories: 310,
              avgHeartRate: 136,
              maxHeartRate: 168,
            },
          ],
        }),
      });
      setDryRunReply(res.message);
      toast.success('Payload format valid (dry run)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Dry run failed';
      setDryRunReply(msg);
      toast.error(msg);
    } finally {
      setCheckingFormat(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parseAppleHealthFileStrict(file.name, text, user.timezone);
      const res = await apiFetch<{
        syncedCount: number;
        user: UserProfile;
        workouts: AppleHealthWorkout[];
      }>('/api/integrations/apple-health', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      onUserUpdated(res.user);
      setWorkouts(res.workouts);
      toast.success(`Imported ${res.syncedCount} item(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Watch className="h-5 w-5 shrink-0 text-[var(--ink)]" />
            <h2 className="font-marker text-lg text-[var(--ink)]">
              Apple Health Sync
            </h2>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={user.appleFitnessEnabled}
            disabled={busy}
            onClick={handleToggle}
            className={`min-h-[44px] min-w-[72px] shrink-0 rounded-xl border-2 border-[var(--line)] px-3 text-sm font-bold transition ${
              user.appleFitnessEnabled
                ? 'bg-[var(--green-bg)] text-[var(--ink)]'
                : 'bg-[var(--surface-alt)] text-[var(--muted)]'
            }`}
          >
            {user.appleFitnessEnabled ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="flex items-start gap-2 rounded-xl border-2 border-[var(--line)] bg-[var(--gold-bg)] p-3 text-sm text-[var(--ink)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0">
            <strong>Strict validation active:</strong> the webhook requires a
            valid <code className="font-mono">startedAt</code> and positive{' '}
            <code className="font-mono">durationMinutes</code> for workouts (or{' '}
            <code className="font-mono">bodyweightKg</code> + date for weight).
            Older Shortcuts that relied on lenient defaults now receive{' '}
            <code className="font-mono">400</code> errors.
          </p>
        </div>

        <div
          aria-label="Last received status"
          className="flex flex-col gap-1.5 rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-3 text-sm"
        >
          <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
            Last Received
          </span>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
            <div className="min-w-0">
              <span className="text-xs text-[var(--muted)]">Time: </span>
              <span className="font-medium text-[var(--ink)]">
                {formatLastReceivedTime(lastReceived.at, user.timezone)}
              </span>
            </div>
            <div className="min-w-0">
              <span className="text-xs text-[var(--muted)]">Content: </span>
              <span className="font-medium text-[var(--ink)]">
                {formatKindLabel(lastReceived.kind)}
              </span>
            </div>
            <div className="min-w-0">
              <span className="text-xs text-[var(--muted)]">Session: </span>
              <span className="font-medium text-[var(--ink)]">
                {formatLinkedLabel(lastReceived.kind, lastReceived.linked)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
            Webhook URL
          </span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={webhookUrl}
              aria-label="Apple Health webhook URL"
              className="min-h-[44px] w-full min-w-0 rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 text-base"
            />
            <Button
              variant="alt"
              size="icon"
              onClick={() => copyText('webhook-url', webhookUrl, 'Webhook URL')}
              aria-label="Copy webhook URL"
              className="min-h-[44px] min-w-[44px] shrink-0"
            >
              {copiedId === 'webhook-url' ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Button
            variant="alt"
            loading={checkingFormat}
            onClick={handleCheckPayloadFormat}
            className="min-h-[44px] w-full justify-center gap-2"
          >
            <FlaskConical className="h-4 w-4" />
            Check payload format
          </Button>
          <p className="text-xs text-[var(--muted)]">
            Sends a sample payload with <code className="font-mono">dryRun: true</code>{' '}
            using your browser session cookie (checks payload format only — it
            cannot verify your API key). Nothing is stored.
          </p>
          {dryRunReply && (
            <div className="rounded-lg border border-[var(--line)]/40 bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--ink)]">
              {dryRunReply}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5 border-t border-[var(--line)]/15 pt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xml,.json,.csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <Button
            variant="alt"
            loading={busy}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] w-full justify-center gap-2"
          >
            <Upload className="h-4 w-4" />
            Import XML / JSON / CSV
          </Button>
          <p className="text-xs text-[var(--muted)]">
            File import stays available even when webhook sync is paused.
          </p>
        </div>

        {workouts.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-[var(--line)]/15 pt-3">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              Recent Syncs
            </span>
            {workouts.slice(0, 5).map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)]/20 bg-[var(--surface)] px-2.5 py-1.5 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{w.workoutType}</span>
                  {w.linkedSessionId && (
                    <span className="shrink-0 rounded-md border border-[var(--line)]/40 bg-[var(--green-bg)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--ink)]">
                      Linked
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-xs text-[var(--muted)]">
                  {w.durationMinutes}m
                  {w.activeCalories !== null ? ` · ${w.activeCalories} kcal` : ''}
                  {w.avgHeartRate !== null ? ` · ${w.avgHeartRate} bpm` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 shrink-0 text-[var(--ink)]" />
          <h2 className="font-marker text-lg text-[var(--ink)]">
            iOS Shortcut Setup Guide
          </h2>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-3 text-sm">
          <p className="text-[var(--ink)]">
            Your Shortcut asks for your API key during setup (never embed a key
            in a shared Shortcut). It uses the{' '}
            <strong>same single personal API key</strong> as MCP — regenerating
            it in Integrations breaks the other until updated.
          </p>
          <Link
            href="/settings/integrations"
            className="btn alt min-h-[44px] w-full justify-center gap-2 no-underline"
          >
            <KeyRound className="h-4 w-4" />
            Manage / Generate API Key in Integrations
          </Link>
        </div>

        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-[var(--ink)]">
          <li>
            Open Apple <strong>Shortcuts</strong> → <strong>Automation</strong>{' '}
            → <strong>+</strong> → <strong>Workout</strong> →{' '}
            <strong>Ends</strong> (Any Workout) →{' '}
            <strong>Run Immediately</strong>.
          </li>
          <li>
            <strong>First action — Dry-run key check:</strong> add{' '}
            <em>Get Contents of URL</em> pointing to your Webhook URL with
            method <code className="font-mono">POST</code>, header{' '}
            <code className="font-mono">Authorization: Bearer YOUR_API_KEY</code>
            , and the dry-run JSON below. Add <em>Get Dictionary Value</em> for{' '}
            <code className="font-mono">message</code> and{' '}
            <em>Show Notification</em> so a wrong or regenerated key is caught
            immediately on your iPhone without saving duplicate data.
          </li>
          <li>
            <strong>Read workout details:</strong> from the automation&apos;s
            Shortcut Input (or <em>Find Health Samples</em>), read Workout Type,
            Start Date (ISO-8601), Duration in minutes, Active Calories (optional),
            and Average / Max Heart Rate (optional).
          </li>
          <li>
            <strong>Send workout POST:</strong> add a second{' '}
            <em>Get Contents of URL</em> (<code className="font-mono">POST</code>
            ) to the Webhook URL with your{' '}
            <code className="font-mono">Authorization</code> header and the
            workout JSON below. Retries with the same start time and workout type
            update in place, and workouts within ±15 min of a logged session
            link automatically in either order.
          </li>
          <li>
            <strong>Optional bodyweight sync:</strong> add{' '}
            <em>Find Health Samples</em> (Type: <strong>Weight</strong> in kg,
            sort by Start Date Latest, Limit 1) and include{' '}
            <code className="font-mono">bodyweightKg</code> inside the workout
            JSON — or send a weight-only payload when logging morning weigh-ins.
          </li>
        </ol>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              1. Dry-Run Check JSON
            </span>
            <Button
              variant="alt"
              onClick={() =>
                copyText('dry-run-json', DRY_RUN_TEMPLATE, 'Dry-run JSON')
              }
              className="min-h-[44px] gap-1.5 px-3 text-sm"
            >
              {copiedId === 'dry-run-json' ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Copy
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-3 font-mono text-xs">
            {DRY_RUN_TEMPLATE}
          </pre>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              2. Workout (+ Optional Bodyweight) JSON
            </span>
            <Button
              variant="alt"
              onClick={() =>
                copyText('workout-json', WORKOUT_JSON_TEMPLATE, 'Workout JSON')
              }
              className="min-h-[44px] gap-1.5 px-3 text-sm"
            >
              {copiedId === 'workout-json' ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Copy
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-3 font-mono text-xs">
            {WORKOUT_JSON_TEMPLATE}
          </pre>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              3. Weight-Only JSON
            </span>
            <Button
              variant="alt"
              onClick={() =>
                copyText(
                  'weight-json',
                  WEIGHT_ONLY_JSON_TEMPLATE,
                  'Weight-only JSON',
                )
              }
              className="min-h-[44px] gap-1.5 px-3 text-sm"
            >
              {copiedId === 'weight-json' ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Copy
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-3 font-mono text-xs">
            {WEIGHT_ONLY_JSON_TEMPLATE}
          </pre>
        </div>
      </section>
    </div>
  );
}
