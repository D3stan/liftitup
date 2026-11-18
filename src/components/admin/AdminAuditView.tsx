'use client';

import React from 'react';
import Link from 'next/link';
import type { AuditLogRecord } from '@/lib/admin/events';
import { formatDateTime } from './formatters';

export function AdminAuditView({
  initialEntries,
}: {
  initialEntries: AuditLogRecord[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-marker text-2xl text-[var(--ink)]">Audit Log</h1>
        <p className="text-xs text-[var(--muted)]">
          Immutable trail of admin views, actions, exports, and CLI password
          resets. Preserved even if a user account is deleted.
        </p>
      </div>

      <section className="card">
        {initialEntries.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No audit entries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--line)] text-[11px] uppercase text-[var(--muted)]">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 px-2">Source</th>
                  <th className="py-2 px-2">Actor</th>
                  <th className="py-2 px-2">Action</th>
                  <th className="py-2 px-2">Target User</th>
                  <th className="py-2 pl-2">Reason / Detail</th>
                </tr>
              </thead>
              <tbody>
                {initialEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-[var(--line)]/20"
                  >
                    <td className="py-2 pr-3 whitespace-nowrap text-[var(--muted)]">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="py-2 px-2 font-mono">{entry.source}</td>
                    <td className="py-2 px-2 font-bold">{entry.actorLabel}</td>
                    <td className="py-2 px-2 font-mono font-bold">
                      {entry.action}
                    </td>
                    <td className="py-2 px-2 font-mono">
                      {entry.targetUserId ? (
                        <Link
                          href={`/admin/users/${encodeURIComponent(entry.targetUserId)}`}
                          className="underline"
                        >
                          {entry.targetUserId}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 pl-2">
                      {entry.reason && (
                        <div className="font-bold text-[var(--ink)]">
                          Reason: {entry.reason}
                        </div>
                      )}
                      {entry.detail && (
                        <div className="font-mono text-[11px] text-[var(--muted)]">
                          {JSON.stringify(entry.detail)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
