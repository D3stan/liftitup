'use client';

import React from 'react';
import { apiFetch, toast } from '@/components/ui';
import { SettingsSubpageShell } from './SettingsSubpageShell';
import { type SettingsPayload, useSettingsData } from './useSettingsData';

export function SettingsTrainingView() {
  const { user, setUser, loading } = useSettingsData();

  async function handleToggleSetQuality() {
    if (!user) return;
    try {
      const res = await apiFetch<SettingsPayload>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ enableSetQuality: !user.enableSetQuality }),
      });
      setUser(res.user);
      toast.success(
        res.user.enableSetQuality ? 'Set quality ON' : 'Set quality OFF',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  }

  return (
    <SettingsSubpageShell title="Training" user={user} loading={loading}>
      {user && (
        <section className="card flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-marker text-base text-[var(--ink)]">
              Execution Quality %
            </h2>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              Track execution quality percentage per set and rep while logging.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={user.enableSetQuality}
            onClick={handleToggleSetQuality}
            className={`min-h-[44px] min-w-[72px] shrink-0 rounded-xl border-2 border-[var(--line)] px-3 text-sm font-bold transition ${
              user.enableSetQuality
                ? 'bg-[var(--green-bg)] text-[var(--ink)]'
                : 'bg-[var(--surface-alt)] text-[var(--muted)]'
            }`}
          >
            {user.enableSetQuality ? 'ON' : 'OFF'}
          </button>
        </section>
      )}
    </SettingsSubpageShell>
  );
}
