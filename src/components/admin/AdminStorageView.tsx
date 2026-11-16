'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Search, Trash2 } from 'lucide-react';
import { apiFetch, Button, toast } from '@/components/ui';
import type { AdminStorageReport } from '@/lib/admin/storage';
import { formatBytes, formatDateTime, formatShortDate } from './formatters';

export function AdminStorageView({
  initialData,
}: {
  initialData: AdminStorageReport;
}) {
  const [data, setData] = useState<AdminStorageReport>(initialData);
  const [search, setSearch] = useState('');
  const [purging, setPurging] = useState(false);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.users;
    return data.users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.userId.toLowerCase().includes(q),
    );
  }, [data.users, search]);

  async function handlePurgeGuests() {
    if (purging) return;
    setPurging(true);
    try {
      const res = await apiFetch<{ purgedCount: number }>('/api/admin/actions', {
        method: 'POST',
        body: JSON.stringify({ action: 'purge_guests' }),
      });
      await apiFetch('/api/admin/actions', {
        method: 'POST',
        body: JSON.stringify({ action: 'refresh_snapshot' }),
      });
      const updated = await apiFetch<AdminStorageReport>('/api/admin/storage');
      setData(updated);
      toast.success(`Purged ${res.purgedCount} expired guest(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Guest purge failed');
    } finally {
      setPurging(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-marker text-2xl text-[var(--ink)]">
            Storage &amp; Users
          </h1>
          <p className="text-xs text-[var(--muted)]">
            Total DB size: <strong>{formatBytes(data.totalDbBytes)}</strong> ·
            Snapshot: {formatDateTime(data.snapshotComputedAt)}
          </p>
        </div>
      </div>

      {/* Guest Footprint & Near Quota */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="card space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-marker text-lg text-[var(--ink)]">
              Guest Sandbox Footprint
            </h2>
            <Button
              variant="alt"
              loading={purging}
              onClick={handlePurgeGuests}
              className="min-h-[44px] gap-1.5 text-sm"
            >
              <Trash2 className="h-4 w-4" />
              Purge Expired
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-xs text-[var(--muted)]">Active guests</div>
              <div className="font-bold">{data.guestFootprint.totalGuests}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)]">
                Expired (&gt;{data.guestFootprint.guestTtlHours}h)
              </div>
              <div className="font-bold">{data.guestFootprint.expiredGuests}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)]">Total held</div>
              <div className="font-bold">
                {formatBytes(data.guestFootprint.totalEstimatedBytes)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)]">
                Next purge frees
              </div>
              <div className="font-bold text-[var(--green)]">
                {formatBytes(data.guestFootprint.reclaimableBytes)}
              </div>
            </div>
          </div>
        </section>

        <section className="card space-y-2.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-[var(--gold)]" />
            <h2 className="font-marker text-lg text-[var(--ink)]">
              Users Near Photo Quota (&ge;80%)
            </h2>
          </div>
          {data.nearQuotaUsers.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No users currently near their photo quota.
            </p>
          ) : (
            <div className="space-y-1.5">
              {data.nearQuotaUsers.map((u) => (
                <Link
                  key={u.userId}
                  href={`/admin/users/${encodeURIComponent(u.userId)}`}
                  className="flex min-h-[44px] items-center justify-between rounded-xl border-2 border-[var(--line)] bg-[var(--gold-bg)] px-3 py-1.5 text-sm no-underline"
                >
                  <span className="font-bold">@{u.username}</span>
                  <span className="font-mono">
                    {u.photos.count} / {u.photos.quota} ({u.photos.quotaUsedPct}
                    %)
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Per-User Storage & Row Counts */}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-marker text-lg text-[var(--ink)]">
              Users ({filteredUsers.length})
            </h2>
            <p className="text-xs text-[var(--muted)]">
              DB row bytes are estimated from Postgres row sizes (indexes &amp;
              shared overhead excluded). Photo bytes come from metadata only.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[var(--muted)]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter username or id…"
              aria-label="Filter users"
              className="min-h-[44px] w-full rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] py-2 pl-9 pr-3 text-base"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--line)] text-[11px] uppercase text-[var(--muted)]">
                <th className="py-2 pr-3">User</th>
                <th className="py-2 px-2">Sessions</th>
                <th className="py-2 px-2">Ex / Sets / RQ</th>
                <th className="py-2 px-2">Custom / Sched / BM / AH</th>
                <th className="py-2 px-2">DB Est.</th>
                <th className="py-2 px-2">Photos</th>
                <th className="py-2 pl-2">Total Est.</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr
                  key={u.userId}
                  className="border-b border-[var(--line)]/20 hover:bg-[var(--surface-alt)]/50"
                >
                  <td className="py-2 pr-3">
                    <Link
                      href={`/admin/users/${encodeURIComponent(u.userId)}`}
                      className="font-bold text-[var(--ink)] underline"
                    >
                      @{u.username}
                    </Link>
                    <div className="text-[11px] text-[var(--muted)]">
                      {u.isGuest ? 'Guest' : 'Reg'}
                      {u.isDisabled ? ' · Disabled' : ''} ·{' '}
                      {formatShortDate(u.lastActiveAt)}
                    </div>
                  </td>
                  <td className="py-2 px-2 font-mono">{u.counts.sessions}</td>
                  <td className="py-2 px-2 font-mono">
                    {u.counts.sessionExercises} / {u.counts.sets} /{' '}
                    {u.counts.repQualities}
                  </td>
                  <td className="py-2 px-2 font-mono">
                    {u.counts.customExercises} / {u.counts.schedules} /{' '}
                    {u.counts.bodyMetrics} / {u.counts.appleHealthWorkouts}
                  </td>
                  <td className="py-2 px-2 font-mono">
                    {formatBytes(u.estimatedDbBytes)}
                  </td>
                  <td className="py-2 px-2 font-mono">
                    {u.photos.count}/{u.photos.quota} (
                    {formatBytes(u.photos.totalBytes)})
                  </td>
                  <td className="py-2 pl-2 font-mono font-bold">
                    {formatBytes(u.totalEstimatedBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Size Per Table */}
      <section className="card space-y-2">
        <h2 className="font-marker text-lg text-[var(--ink)]">
          Size Per Table
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--line)] text-xs uppercase text-[var(--muted)]">
                <th className="py-2 pr-3">Table</th>
                <th className="py-2 px-2">Total Size</th>
                <th className="py-2 px-2">Heap</th>
                <th className="py-2 px-2">Indexes / Toast</th>
                <th className="py-2 pl-2">Est. Rows</th>
              </tr>
            </thead>
            <tbody>
              {data.tableSizes.map((t) => (
                <tr
                  key={t.tableName}
                  className="border-b border-[var(--line)]/20"
                >
                  <td className="py-1.5 pr-3 font-mono font-bold">
                    {t.tableName}
                  </td>
                  <td className="py-1.5 px-2 font-mono">
                    {formatBytes(t.totalBytes)}
                  </td>
                  <td className="py-1.5 px-2 font-mono">
                    {formatBytes(t.heapBytes)}
                  </td>
                  <td className="py-1.5 px-2 font-mono">
                    {formatBytes(t.indexToastBytes)}
                  </td>
                  <td className="py-1.5 pl-2 font-mono">{t.estimatedRows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
