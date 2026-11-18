'use client';

import React, { useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { apiFetch, Button, toast } from '@/components/ui';
import type { AdminSystemHealthReport } from '@/lib/admin/health';
import { formatDateTime } from './formatters';

export function AdminHealthView({
  initialData,
}: {
  initialData: AdminSystemHealthReport;
}) {
  const [data, setData] = useState<AdminSystemHealthReport>(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [purging, setPurging] = useState(false);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const fresh = await apiFetch<AdminSystemHealthReport>('/api/admin/health');
      setData(fresh);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  async function handlePurgeNow() {
    if (purging) return;
    setPurging(true);
    try {
      const res = await apiFetch<{ purgedCount: number }>('/api/admin/actions', {
        method: 'POST',
        body: JSON.stringify({ action: 'purge_guests' }),
      });
      const fresh = await apiFetch<AdminSystemHealthReport>('/api/admin/health');
      setData(fresh);
      toast.success(`Guest purge ran (${res.purgedCount} removed)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Purge failed');
    } finally {
      setPurging(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-marker text-2xl text-[var(--ink)]">
            System Health
          </h1>
          <p className="text-xs text-[var(--muted)]">
            Last {data.requests.windowHours}h · Generated{' '}
            {formatDateTime(data.generatedAt)}
          </p>
        </div>
        <Button
          variant="alt"
          loading={refreshing}
          onClick={handleRefresh}
          className="min-h-[44px] gap-1.5"
        >
          <RefreshCw className="h-4 w-4" />
          Flush &amp; Refresh
        </Button>
      </div>

      {/* Top Health Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <section className="card-sm space-y-1">
          <div className="text-xs font-bold uppercase text-[var(--muted)]">
            Requests ({data.requests.windowHours}h)
          </div>
          <div className="font-marker text-2xl">
            {data.requests.totalRequests}
          </div>
          <div className="text-xs text-[var(--muted)]">
            Error rate: {data.requests.errorRatePct}% (4xx:{' '}
            {data.requests.total4xx}, 5xx: {data.requests.total5xx}) · Avg{' '}
            {data.requests.avgLatencyMs}ms
          </div>
        </section>

        <section className="card-sm space-y-1">
          <div className="text-xs font-bold uppercase text-[var(--muted)]">
            Database Pool
          </div>
          <div className="font-marker text-2xl">
            {data.database.pool.totalCount} / {data.database.pool.maxConnections}
          </div>
          <div className="text-xs text-[var(--muted)]">
            Idle: {data.database.pool.idleCount} · Waiting:{' '}
            {data.database.pool.waitingCount} · Queries:{' '}
            {data.database.totalQueriesExecuted}
          </div>
        </section>

        <section className="card-sm space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-[var(--muted)]">
              Guest Purge
            </span>
            <Button
              variant="alt"
              loading={purging}
              onClick={handlePurgeNow}
              className="!min-h-[34px] !px-2 text-xs gap-1"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Run
            </Button>
          </div>
          <div className="text-sm font-bold">
            Last run: {formatDateTime(data.guestPurge.lastRunAt)}
          </div>
          <div className="text-xs text-[var(--muted)]">
            Last removed: {data.guestPurge.lastPurgedCount} · Total:{' '}
            {data.guestPurge.totalPurgedCount} · Expired now:{' '}
            {data.guestPurge.currentlyExpiredCount}
          </div>
        </section>
      </div>

      {/* Apple Health Ingest */}
      <section className="card space-y-2">
        <h2 className="font-marker text-lg text-[var(--ink)]">
          Apple Health Ingest
        </h2>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <div>
            <div className="text-xs text-[var(--muted)]">Payloads Received</div>
            <div className="font-bold">{data.ingest.receivedCount}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--muted)]">Payloads Rejected</div>
            <div className="font-bold text-[var(--red)]">
              {data.ingest.rejectedCount}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--muted)]">Stored Workouts</div>
            <div className="font-bold">{data.ingest.storedWorkouts}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--muted)]">Linked</div>
            <div className="font-bold text-[var(--green)]">
              {data.ingest.linkedWorkouts}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--muted)]">Unlinked</div>
            <div className="font-bold">{data.ingest.unlinkedWorkouts}</div>
          </div>
        </div>
      </section>

      {/* Per-Route Latency & Errors */}
      <section className="card space-y-2">
        <h2 className="font-marker text-lg text-[var(--ink)]">
          Requests Per Route
        </h2>
        {data.requests.routes.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No route metrics flushed in this window yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--line)] text-[11px] uppercase text-[var(--muted)]">
                  <th className="py-2 pr-3">Route</th>
                  <th className="py-2 px-2">Method</th>
                  <th className="py-2 px-2">Count</th>
                  <th className="py-2 px-2">4xx / 5xx</th>
                  <th className="py-2 px-2">Err %</th>
                  <th className="py-2 px-2">Avg ms</th>
                  <th className="py-2 pl-2">Max ms</th>
                </tr>
              </thead>
              <tbody>
                {data.requests.routes.map((r) => (
                  <tr
                    key={`${r.route}-${r.method}`}
                    className="border-b border-[var(--line)]/20"
                  >
                    <td className="py-1.5 pr-3 font-mono font-bold">
                      {r.route}
                    </td>
                    <td className="py-1.5 px-2 font-mono">{r.method}</td>
                    <td className="py-1.5 px-2 font-mono">{r.requestCount}</td>
                    <td className="py-1.5 px-2 font-mono">
                      {r.error4xxCount} / {r.error5xxCount}
                    </td>
                    <td className="py-1.5 px-2 font-mono">{r.errorRatePct}%</td>
                    <td className="py-1.5 px-2 font-mono">{r.avgLatencyMs}</td>
                    <td className="py-1.5 pl-2 font-mono">{r.maxLatencyMs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent Errors & Slow Queries */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card space-y-2">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Recent Server Failures
          </h2>
          {data.errors.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No 5xx errors recorded.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {data.errors.map((e) => (
                <div
                  key={e.id}
                  className="rounded-xl border border-[var(--red)]/40 bg-[var(--red-bg)]/30 p-2.5 text-xs"
                >
                  <div className="flex items-center justify-between font-bold">
                    <span className="font-mono">
                      {e.method} {e.route} ({e.status})
                    </span>
                    <span className="text-[var(--muted)]">
                      {formatDateTime(e.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[var(--ink)]">{e.message}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card space-y-2">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Slow Queries (&ge;{data.database.slowQueryThresholdMs}ms)
          </h2>
          {data.database.slowQueries.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No slow queries observed in this process.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {data.database.slowQueries.map((sq, idx) => (
                <div
                  key={`${sq.recordedAt}-${idx}`}
                  className="rounded-xl border border-[var(--line)]/40 bg-[var(--surface)] p-2.5 text-xs"
                >
                  <div className="flex items-center justify-between font-bold">
                    <span className="text-[var(--red)]">{sq.durationMs} ms</span>
                    <span className="text-[var(--muted)]">
                      {formatDateTime(sq.recordedAt)}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] break-all text-[var(--muted)]">
                    {sq.sql}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
