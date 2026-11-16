'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Users, Activity, Database, ArrowRight } from 'lucide-react';
import { SvgBarChart } from '@/components/progress/SvgBarChart';
import { SvgLineChart } from '@/components/progress/SvgLineChart';
import { apiFetch, Button, toast } from '@/components/ui';
import type { AdminOverviewData } from '@/lib/admin/overview';
import { formatBytes, formatDateTime, formatShortDate } from './formatters';

export function AdminOverviewView({
  initialData,
}: {
  initialData: AdminOverviewData;
}) {
  const [data, setData] = useState<AdminOverviewData>(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [churnTab, setChurnTab] = useState<'14d' | '30d'>('14d');

  async function handleRefreshSnapshot() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await apiFetch('/api/admin/actions', {
        method: 'POST',
        body: JSON.stringify({ action: 'refresh_snapshot' }),
      });
      const fresh = await apiFetch<AdminOverviewData>('/api/admin/overview');
      setData(fresh);
      toast.success('Daily snapshot refreshed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  const churnList =
    churnTab === '14d' ? data.churn.inactive14d : data.churn.inactive30d;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-marker text-2xl text-[var(--ink)]">
            Instance Overview
          </h1>
          <p className="text-xs text-[var(--muted)]">
            Snapshot computed: {formatDateTime(data.snapshotComputedAt)}
          </p>
        </div>
        <Button
          variant="alt"
          loading={refreshing}
          onClick={handleRefreshSnapshot}
          className="min-h-[44px] gap-1.5"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh Snapshot
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card-sm">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-[var(--muted)]">
            <Users className="h-3.5 w-3.5" /> Users
          </div>
          <div className="mt-1 font-marker text-2xl text-[var(--ink)]">
            {data.users.total}
          </div>
          <div className="text-xs text-[var(--muted)]">
            {data.users.registered} reg · {data.users.guest} guest ·{' '}
            {data.users.disabled} disabled
          </div>
        </div>

        <div className="card-sm">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-[var(--muted)]">
            <Activity className="h-3.5 w-3.5" /> Active (1d / 7d / 30d)
          </div>
          <div className="mt-1 font-marker text-2xl text-[var(--ink)]">
            {data.activeUsers.d1} / {data.activeUsers.d7} / {data.activeUsers.d30}
          </div>
          <div className="text-xs text-[var(--muted)]">
            Stickiness: {data.activeUsers.stickinessPct}% (DAU/MAU)
          </div>
        </div>

        <div className="card-sm">
          <div className="text-xs font-bold uppercase text-[var(--muted)]">
            Guest Conversions
          </div>
          <div className="mt-1 font-marker text-2xl text-[var(--ink)]">
            {data.guestConversion.totalConversions}
          </div>
          <div className="text-xs text-[var(--muted)]">
            30d: {data.guestConversion.conversions30d} /{' '}
            {data.guestConversion.guestsCreated30d} guests (
            {data.guestConversion.conversionRate30dPct}%)
          </div>
        </div>

        <div className="card-sm">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-[var(--muted)]">
            <Database className="h-3.5 w-3.5" /> Database Size
          </div>
          <div className="mt-1 font-marker text-2xl text-[var(--ink)]">
            {formatBytes(data.storage.totalDbBytes)}
          </div>
          <div className="text-xs text-[var(--muted)]">
            {data.storage.tableSizes.length} tables tracked
          </div>
        </div>
      </div>

      {/* App vs API Key Activity */}
      <section className="card space-y-2">
        <h2 className="font-marker text-lg text-[var(--ink)]">
          App vs API-Key Activity
        </h2>
        {!data.activeUsers.hasActivityEvents ? (
          <p className="text-sm text-[var(--muted)]">
            No separated app/API-key activity events recorded yet. Activity events
            accumulate automatically as users browse or call MCP/Shortcut.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-3">
              <div className="text-xs font-bold uppercase text-[var(--muted)]">
                App (Cookie Sessions)
              </div>
              <div className="mt-1 font-marker text-xl text-[var(--ink)]">
                1d: {data.activeUsers.app.d1} · 7d: {data.activeUsers.app.d7} ·
                30d: {data.activeUsers.app.d30}
              </div>
            </div>
            <div className="rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-3">
              <div className="text-xs font-bold uppercase text-[var(--muted)]">
                API Key (MCP &amp; Shortcut)
              </div>
              <div className="mt-1 font-marker text-xl text-[var(--ink)]">
                1d: {data.activeUsers.apiKey.d1} · 7d:{' '}
                {data.activeUsers.apiKey.d7} · 30d: {data.activeUsers.apiKey.d30}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card space-y-2">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            New Signups Per Day (30d)
          </h2>
          <SvgBarChart
            points={data.users.newPerDay.map((d) => ({
              label: d.date,
              value: d.total,
            }))}
            unitLabel="users"
            emptyLabel="No signups in last 30 days"
          />
          {data.users.newPerWeek.length > 0 && (
            <p className="text-xs text-[var(--muted)]">
              Latest week ({data.users.newPerWeek.at(-1)?.weekStart}):{' '}
              {data.users.newPerWeek.at(-1)?.registered ?? 0} registered,{' '}
              {data.users.newPerWeek.at(-1)?.guest ?? 0} guest
            </p>
          )}
        </section>

        <section className="card space-y-2">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Daily Logged Volume (Sessions &amp; kg)
          </h2>
          <SvgLineChart
            points={data.dailyVolume.map((v) => ({
              label: v.date,
              value: v.totalKg,
              sublabel: `${v.sessions} sessions · ${v.sets} sets`,
            }))}
            unitLabel="kg"
            primaryLabel="Total kg"
            emptyLabel="No sessions logged in last 30 days"
          />
        </section>

        <section className="card space-y-2">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Active Users Trend (Snapshots)
          </h2>
          <SvgLineChart
            points={data.activeUsers.trends.map((t) => ({
              label: t.snapshotDate,
              value: t.dau,
              sublabel: `Stickiness ${t.stickinessPct}%`,
            }))}
            secondaryPoints={data.activeUsers.trends.map((t) => t.mau)}
            primaryLabel="DAU"
            secondaryLabel="MAU"
            unitLabel="users"
            emptyLabel="Trends populate across daily snapshots"
          />
        </section>

        <section className="card space-y-2">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Database Growth Over Time
          </h2>
          <SvgLineChart
            points={data.storage.growthOverTime.map((g) => ({
              label: g.snapshotDate,
              value: Math.round((g.totalDbBytes / (1024 * 1024)) * 100) / 100,
            }))}
            unitLabel="MB"
            primaryLabel="Total DB (MB)"
            strokeColor="var(--green)"
            emptyLabel="Growth populates across daily snapshots"
          />
        </section>
      </div>

      {/* Retention Cohort Table */}
      <section className="card space-y-3">
        <div>
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Retention by Signup Week
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Registered users who logged at least one workout in days 0-6 (W0),
            7-13 (W1), 14-20 (W2), 28-34 (W4), and 56-62 (W8) after signup.
          </p>
        </div>
        {data.retentionCohorts.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No registered user cohorts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--line)] text-xs uppercase text-[var(--muted)]">
                  <th className="py-2 pr-3">Cohort Week</th>
                  <th className="py-2 px-2">Size</th>
                  <th className="py-2 px-2">W0</th>
                  <th className="py-2 px-2">W1</th>
                  <th className="py-2 px-2">W2</th>
                  <th className="py-2 px-2">W4</th>
                  <th className="py-2 pl-2">W8</th>
                </tr>
              </thead>
              <tbody>
                {data.retentionCohorts.map((c) => (
                  <tr
                    key={c.cohortWeek}
                    className="border-b border-[var(--line)]/20"
                  >
                    <td className="py-2 pr-3 font-mono font-bold">
                      {c.cohortWeek}
                    </td>
                    <td className="py-2 px-2">{c.cohortSize}</td>
                    <td className="py-2 px-2">{c.week0}</td>
                    <td className="py-2 px-2">{c.week1}</td>
                    <td className="py-2 px-2">{c.week2}</td>
                    <td className="py-2 px-2">{c.week4}</td>
                    <td className="py-2 pl-2">{c.week8}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Churn List & Largest Users */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-marker text-lg text-[var(--ink)]">
              Churn Watch (No Session)
            </h2>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setChurnTab('14d')}
                className={`min-h-[44px] rounded-xl border-2 border-[var(--line)] px-3 text-xs font-bold ${
                  churnTab === '14d'
                    ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                    : 'bg-[var(--surface)] text-[var(--muted)]'
                }`}
              >
                14+ days ({data.churn.inactive14d.length})
              </button>
              <button
                type="button"
                onClick={() => setChurnTab('30d')}
                className={`min-h-[44px] rounded-xl border-2 border-[var(--line)] px-3 text-xs font-bold ${
                  churnTab === '30d'
                    ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                    : 'bg-[var(--surface)] text-[var(--muted)]'
                }`}
              >
                30+ days ({data.churn.inactive30d.length})
              </button>
            </div>
          </div>

          {churnList.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No inactive registered users in this window.
            </p>
          ) : (
            <div className="space-y-2">
              {churnList.slice(0, 15).map((u) => (
                <Link
                  key={u.userId}
                  href={`/admin/users/${encodeURIComponent(u.userId)}`}
                  className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm no-underline hover:bg-[var(--surface-alt)]"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-[var(--ink)] truncate">
                      @{u.username}{' '}
                      {u.isDisabled && (
                        <span className="text-xs text-[var(--red)]">
                          (disabled)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      Last session:{' '}
                      {u.lastSessionDate
                        ? `${u.lastSessionDate} (${u.daysSinceLastSession}d ago)`
                        : `Never (joined ${formatShortDate(u.createdAt)})`}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-marker text-lg text-[var(--ink)]">
              Largest Users by Storage
            </h2>
            <Link
              href="/admin/storage"
              className="text-xs font-bold text-[var(--ink)] underline"
            >
              View all
            </Link>
          </div>
          {data.storage.largestUsers.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No user storage data yet.</p>
          ) : (
            <div className="space-y-2">
              {data.storage.largestUsers.map((u) => (
                <Link
                  key={u.userId}
                  href={`/admin/users/${encodeURIComponent(u.userId)}`}
                  className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm no-underline hover:bg-[var(--surface-alt)]"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-[var(--ink)] truncate">
                      @{u.username}{' '}
                      {u.isGuest && (
                        <span className="text-xs text-[var(--muted)]">
                          (guest)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      DB ~{formatBytes(u.estimatedDbBytes)} · Photos{' '}
                      {formatBytes(u.photoBytes)} ({u.photoCount})
                    </div>
                  </div>
                  <span className="font-mono font-bold text-[var(--ink)] shrink-0">
                    {formatBytes(u.totalEstimatedBytes)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
