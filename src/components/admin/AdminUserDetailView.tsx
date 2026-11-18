'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Download,
  KeyRound,
  LogOut,
  Trash2,
} from 'lucide-react';
import { apiFetch, Button, toast } from '@/components/ui';
import type { AdminUserDetail } from '@/lib/admin/userDetail';
import { formatBytes, formatDateTime, formatShortDate } from './formatters';

export function AdminUserDetailView({
  initialData,
  currentAdminId,
}: {
  initialData: AdminUserDetail;
  currentAdminId: string;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<AdminUserDetail>(initialData);
  const [busy, setBusy] = useState<string | null>(null);
  const [quotaInput, setQuotaInput] = useState(
    initialData.account.photoQuotaOverride !== null
      ? String(initialData.account.photoQuotaOverride)
      : '',
  );
  const [exportReason, setExportReason] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const acct = detail.account;
  const isSelf = acct.id === currentAdminId;

  async function runAction(
    actionName: string,
    payload: Record<string, unknown>,
    successMsg: string,
  ) {
    if (busy) return;
    setBusy(actionName);
    try {
      await apiFetch(`/api/admin/users/${encodeURIComponent(acct.id)}/action`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      toast.success(successMsg);
      if (actionName === 'delete_user') {
        router.push('/admin/storage');
        return;
      }
      // Update local state optimistically / via targeted state patch to avoid redundant view logs
      if (actionName === 'disable') {
        setDetail((prev) => ({
          ...prev,
          account: { ...prev.account, isDisabled: true, activeSessions: [] },
        }));
      } else if (actionName === 'enable') {
        setDetail((prev) => ({
          ...prev,
          account: { ...prev.account, isDisabled: false },
        }));
      } else if (actionName === 'force_logout') {
        setDetail((prev) => ({
          ...prev,
          account: { ...prev.account, activeSessions: [] },
        }));
      } else if (actionName === 'revoke_api_key') {
        setDetail((prev) => ({
          ...prev,
          featuresUsed: {
            ...prev.featuresUsed,
            mcp: {
              hasApiKey: false,
              keyPrefix: null,
              createdAt: null,
              lastUsedAt: null,
            },
          },
        }));
      } else if (actionName === 'adjust_photo_quota') {
        const nextOverride =
          payload.photoQuota === null ? null : Number(payload.photoQuota);
        const nextEff = nextOverride !== null ? nextOverride : 300;
        const pct =
          nextEff > 0
            ? Math.round((detail.featuresUsed.photos.count / nextEff) * 1000) / 10
            : 0;
        setDetail((prev) => ({
          ...prev,
          account: {
            ...prev.account,
            photoQuotaOverride: nextOverride,
            effectivePhotoQuota: nextEff,
          },
          featuresUsed: {
            ...prev.featuresUsed,
            photos: {
              ...prev.featuresUsed.photos,
              quota: nextEff,
              quotaUsedPct: pct,
            },
          },
        }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleExportData(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const reason = exportReason.trim();
    if (reason.length < 3) {
      toast.error('Please type a reason (at least 3 characters)');
      return;
    }

    setBusy('export');
    try {
      const res = await apiFetch<{
        filename: string;
        data: unknown;
        auditId: string;
      }>(`/api/admin/users/${encodeURIComponent(acct.id)}/export`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });

      const blob = new Blob([JSON.stringify(res.data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename || `liftitup-export-${acct.username}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setExportReason('');
      toast.success(`Audited export downloaded (${res.auditId})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/admin/storage"
            className="btn alt !min-h-[44px] !px-3 text-sm no-underline"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Users</span>
          </Link>
          <div className="min-w-0">
            <h1 className="font-marker text-2xl text-[var(--ink)] truncate">
              @{acct.username}
            </h1>
            <p className="text-xs text-[var(--muted)] font-mono truncate">
              {acct.id} · {acct.displayName}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {acct.isGuest && <span className="pill gold text-xs">GUEST</span>}
          {acct.isDisabled && (
            <span className="pill text-xs bg-[var(--red-bg)] text-[var(--red)]">
              DISABLED
            </span>
          )}
          {acct.mustChangePassword && (
            <span className="pill gold text-xs">MUST CHANGE PASSWORD</span>
          )}
        </div>
      </div>

      {/* Account & Active Sessions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card space-y-2.5">
          <h2 className="font-marker text-lg text-[var(--ink)]">Account</h2>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-[var(--muted)]">Signed up</dt>
              <dd className="font-bold">{formatShortDate(acct.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Last active</dt>
              <dd className="font-bold">{formatDateTime(acct.lastActiveAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Unit / Timezone</dt>
              <dd className="font-bold">
                {acct.unit} · {acct.timezone}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Theme</dt>
              <dd className="font-bold">
                {acct.theme} ({acct.themeVariant})
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Rest Clock</dt>
              <dd className="font-bold">{acct.restClockMode}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Default View</dt>
              <dd className="font-bold">{acct.defaultWorkoutView}</dd>
            </div>
          </dl>

          <div className="pt-2 border-t border-[var(--line)]/20">
            <div className="text-xs font-bold uppercase text-[var(--muted)]">
              Active Login Sessions ({acct.activeSessions.length})
            </div>
            {acct.activeSessions.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                No active non-expired sessions.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1 text-xs">
                {acct.activeSessions.map((s, idx) => (
                  <li
                    key={`${s.createdAt}-${idx}`}
                    className="rounded-lg border border-[var(--line)]/30 bg-[var(--surface)] px-2.5 py-1.5"
                  >
                    Created {formatDateTime(s.createdAt)} · Last seen{' '}
                    {formatDateTime(s.lastSeenAt)} · Expires{' '}
                    {formatShortDate(s.expiresAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Admin Actions */}
        <section className="card space-y-3">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Admin Actions
          </h2>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {acct.isDisabled ? (
              <Button
                variant="alt"
                loading={busy === 'enable'}
                disabled={busy !== null}
                onClick={() =>
                  void runAction(
                    'enable',
                    { action: 'enable' },
                    'User account re-enabled',
                  )
                }
                className="min-h-[44px] gap-1.5"
              >
                <CheckCircle2 className="h-4 w-4 text-[var(--green)]" />
                Enable Account
              </Button>
            ) : (
              <Button
                variant="red"
                loading={busy === 'disable'}
                disabled={busy !== null || isSelf}
                onClick={() =>
                  void runAction(
                    'disable',
                    { action: 'disable' },
                    'Account disabled and sessions revoked',
                  )
                }
                className="min-h-[44px] gap-1.5"
              >
                <Ban className="h-4 w-4" />
                Disable Account
              </Button>
            )}

            <Button
              variant="alt"
              loading={busy === 'force_logout'}
              disabled={busy !== null}
              onClick={() =>
                void runAction(
                  'force_logout',
                  { action: 'force_logout' },
                  'All active sessions revoked',
                )
              }
              className="min-h-[44px] gap-1.5"
            >
              <LogOut className="h-4 w-4" />
              Force Logout
            </Button>

            <Button
              variant="alt"
              loading={busy === 'revoke_api_key'}
              disabled={busy !== null || !detail.featuresUsed.mcp.hasApiKey}
              onClick={() =>
                void runAction(
                  'revoke_api_key',
                  { action: 'revoke_api_key' },
                  'API key revoked',
                )
              }
              className="min-h-[44px] gap-1.5 sm:col-span-2"
            >
              <KeyRound className="h-4 w-4" />
              Revoke API Key
            </Button>
          </div>

          {/* Photo Quota */}
          <div className="rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-3 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold uppercase text-[var(--muted)]">
              <span>Photo Quota</span>
              <span>
                {detail.featuresUsed.photos.count} /{' '}
                {acct.effectivePhotoQuota} used (
                {formatBytes(detail.featuresUsed.photos.totalBytes)})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                type="number"
                min={0}
                max={10000}
                value={quotaInput}
                onChange={(e) => setQuotaInput(e.target.value)}
                placeholder="Default (300)"
                aria-label="Photo quota limit"
                className="min-h-[44px] w-36 rounded-xl border-2 border-[var(--line)] bg-[var(--card)] px-3 text-base"
              />
              <Button
                variant="alt"
                loading={busy === 'adjust_photo_quota'}
                disabled={busy !== null}
                onClick={() => {
                  const trimmed = quotaInput.trim();
                  const parsed = trimmed === '' ? null : Number(trimmed);
                  if (
                    parsed !== null &&
                    (!Number.isInteger(parsed) || parsed < 0 || parsed > 10000)
                  ) {
                    toast.error('Enter an integer 0..10000 or leave blank for default');
                    return;
                  }
                  void runAction(
                    'adjust_photo_quota',
                    { action: 'adjust_photo_quota', photoQuota: parsed },
                    parsed === null
                      ? 'Photo quota reset to default (300)'
                      : `Photo quota updated to ${parsed}`,
                  );
                }}
                className="min-h-[44px]"
              >
                Save Quota
              </Button>
            </div>
          </div>

          {/* Audited Export */}
          <form
            onSubmit={handleExportData}
            className="rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-3 space-y-2"
          >
            <div className="text-xs font-bold uppercase text-[var(--muted)]">
              Audited Support Export (Excludes Photos)
            </div>
            <input
              type="text"
              required
              minLength={3}
              maxLength={500}
              value={exportReason}
              onChange={(e) => setExportReason(e.target.value)}
              placeholder="Typed reason for audit log (required)"
              aria-label="Export reason"
              className="min-h-[44px] w-full rounded-xl border-2 border-[var(--line)] bg-[var(--card)] px-3 text-base"
            />
            <Button
              type="submit"
              variant="alt"
              loading={busy === 'export'}
              disabled={busy !== null}
              className="min-h-[44px] w-full gap-1.5"
            >
              <Download className="h-4 w-4" />
              Export User JSON (Audited)
            </Button>
          </form>

          {/* Delete User */}
          {!isSelf && (
            <div className="rounded-xl border-2 border-[var(--red)] bg-[var(--red-bg)]/40 p-3 space-y-2">
              <div className="text-xs font-bold uppercase text-[var(--red)]">
                Delete User (Preserves Audit &amp; Events)
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder="Type DELETE"
                  aria-label="Type DELETE to confirm user deletion"
                  className="min-h-[44px] flex-1 rounded-xl border-2 border-[var(--line)] bg-[var(--card)] px-3 text-base"
                />
                <Button
                  variant="red"
                  loading={busy === 'delete_user'}
                  disabled={
                    busy !== null ||
                    deleteConfirm.trim().toUpperCase() !== 'DELETE'
                  }
                  onClick={() =>
                    void runAction(
                      'delete_user',
                      { action: 'delete_user', confirmation: deleteConfirm },
                      'User account deleted',
                    )
                  }
                  className="min-h-[44px] gap-1.5"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          )}

          <p className="text-xs text-[var(--muted)]">
            Password resets are not available on admin web pages. Use the CLI in
            the container terminal:{' '}
            <code className="font-mono">
              node scripts/reset-password.mjs {acct.username}
            </code>
          </p>
        </section>
      </div>

      {/* Training & Logging Behaviour */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card space-y-2.5">
          <h2 className="font-marker text-lg text-[var(--ink)]">Training</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--muted)]">Sessions</dt>
              <dd className="font-bold">
                {detail.training.totalSessions} ({detail.training.sessionsPerWeek}/wk)
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Streaks (Cur / Best)</dt>
              <dd className="font-bold">
                {detail.training.currentStreakDays}d /{' '}
                {detail.training.longestStreakDays}d
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Avg Duration</dt>
              <dd className="font-bold">
                {detail.training.avgSessionDurationMinutes !== null
                  ? `${detail.training.avgSessionDurationMinutes} min`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Jolly / Swaps</dt>
              <dd className="font-bold">
                {detail.training.jollySessions} jolly ·{' '}
                {detail.training.swapsMade} swaps
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Skipped / Postponed</dt>
              <dd className="font-bold">
                {detail.training.skippedDays} skip ·{' '}
                {detail.training.postponedDays} postpone
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">
                Planned vs Completed
              </dt>
              <dd className="font-bold">
                {detail.training.plannedVsCompleted.hasActiveSchedule
                  ? `${detail.training.plannedVsCompleted.completedDays}/${detail.training.plannedVsCompleted.plannedTrainingDays} (${detail.training.plannedVsCompleted.completionRatePct}%)`
                  : 'No active split'}
              </dd>
            </div>
          </dl>
        </section>

        <section className="card space-y-2.5">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Logging Behaviour
          </h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--muted)]">Sets / Session</dt>
              <dd className="font-bold">
                {detail.loggingBehaviour.avgSetsPerSession} ({detail.loggingBehaviour.totalSets} total)
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Avg Actual Rest</dt>
              <dd className="font-bold">
                {detail.loggingBehaviour.avgActualRestSeconds !== null
                  ? `${detail.loggingBehaviour.avgActualRestSeconds}s (${detail.loggingBehaviour.setsWithActualRest} sets)`
                  : 'Not measured'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Quality Ratings</dt>
              <dd className="font-bold">
                {detail.loggingBehaviour.repQualitySharePct}% (
                {detail.loggingBehaviour.setsWithQualityRating} sets)
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Custom Exercises</dt>
              <dd className="font-bold">
                {detail.loggingBehaviour.customExercises.length}
              </dd>
            </div>
          </dl>

          {detail.loggingBehaviour.mostUsedExercises.length > 0 && (
            <div className="pt-2 border-t border-[var(--line)]/20">
              <div className="text-xs font-bold uppercase text-[var(--muted)]">
                Most Used Exercises (Counts Only)
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {detail.loggingBehaviour.mostUsedExercises.map((ex) => (
                  <span
                    key={ex.exerciseId}
                    className="rounded-lg border border-[var(--line)]/40 bg-[var(--surface)] px-2 py-1 text-xs"
                  >
                    <strong>{ex.name}</strong> ({ex.setCount} sets)
                  </span>
                ))}
              </div>
            </div>
          )}

          {detail.loggingBehaviour.customExercises.length > 0 && (
            <div className="pt-2 border-t border-[var(--line)]/20">
              <div className="text-xs font-bold uppercase text-[var(--muted)]">
                Custom Exercise Names
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {detail.loggingBehaviour.customExercises.map((ex) => (
                  <span
                    key={ex.id}
                    className="rounded-lg border border-[var(--line)]/40 bg-[var(--surface)] px-2 py-0.5 text-xs"
                  >
                    {ex.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Features Used & Event Timeline */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card space-y-2.5">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Features Used
          </h2>
          <dl className="grid grid-cols-2 gap-2.5 text-sm">
            <div>
              <dt className="text-xs text-[var(--muted)]">MCP / API Key</dt>
              <dd className="font-bold">
                {detail.featuresUsed.mcp.hasApiKey
                  ? `${detail.featuresUsed.mcp.keyPrefix}•••• (last used ${formatDateTime(detail.featuresUsed.mcp.lastUsedAt)})`
                  : 'No key'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">
                Apple Health Last Received
              </dt>
              <dd className="font-bold">
                {detail.featuresUsed.appleHealth.lastReceivedAt
                  ? `${formatDateTime(detail.featuresUsed.appleHealth.lastReceivedAt)} (${detail.featuresUsed.appleHealth.workoutCount} workouts)`
                  : 'Never received'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">AI / File Imports</dt>
              <dd className="font-bold">
                {detail.featuresUsed.aiImportCount} AI ·{' '}
                {detail.featuresUsed.fileImportCount} file
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">
                Exports / Photo ZIP
              </dt>
              <dd className="font-bold">
                {detail.featuresUsed.exportCount} data ·{' '}
                {detail.featuresUsed.photoArchiveExportCount} photo zip
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Focus Mode</dt>
              <dd className="font-bold">
                {detail.featuresUsed.focusModeUsed ? 'Used' : 'Not yet'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Clock Mode</dt>
              <dd className="font-bold">{detail.featuresUsed.restClockMode}</dd>
            </div>
          </dl>
        </section>

        <section className="card space-y-2.5">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Event Timeline
          </h2>
          {detail.timeline.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No recorded events for this user yet.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
              {detail.timeline.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)]/30 bg-[var(--surface)] px-2.5 py-1.5 text-xs"
                >
                  <div className="min-w-0">
                    <span className="font-mono font-bold text-[var(--ink)]">
                      {ev.eventType}
                    </span>
                    {ev.detail && (
                      <span className="ml-2 text-[var(--muted)]">
                        {JSON.stringify(ev.detail)}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-[var(--muted)]">
                    {formatDateTime(ev.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
