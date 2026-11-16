'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, LogOut, Scale } from 'lucide-react';
import { Button, apiFetch, toast } from '@/components/ui';
import { kgToBodyDisplay } from '@/lib/body/weight';
import type { UserProfile, WeightUnit } from '@/types/domain';
import { SettingsSubpageShell } from './SettingsSubpageShell';
import { type SettingsPayload, useSettingsData } from './useSettingsData';

export function SettingsProfileView() {
  const { user, setUser, setApiKeyInfo, loading, loggingOut, handleLogout } =
    useSettingsData();
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [age, setAge] = useState('');
  const [trainingYears, setTrainingYears] = useState('');
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [timezone, setTimezone] = useState('UTC');

  const syncForm = useCallback((u: UserProfile) => {
    setDisplayName(u.displayName);
    setHeightCm(u.heightCm !== null ? String(u.heightCm) : '');
    setAge(u.age !== null ? String(u.age) : '');
    setTrainingYears(u.trainingYears !== null ? String(u.trainingYears) : '');
    setUnit(u.unit);
    setTimezone(u.timezone);
  }, []);

  useEffect(() => {
    if (user) {
      syncForm(user);
    }
  }, [user, syncForm]);

  function handleUnitChange(nextUnit: WeightUnit) {
    if (nextUnit === unit) return;
    setUnit(nextUnit);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    try {
      const res = await apiFetch<SettingsPayload>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: displayName.trim(),
          heightCm: heightCm.trim() ? Number(heightCm) : null,
          age: age.trim() ? Number(age) : null,
          trainingYears: trainingYears.trim() ? Number(trainingYears) : null,
          unit,
          timezone: timezone.trim(),
        }),
      });
      setUser(res.user);
      setApiKeyInfo(res.apiKey);
      syncForm(res.user);
      window.dispatchEvent(new Event('liftitup:user-updated'));
      toast.success('Profile saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSubpageShell title="Profile" user={user} loading={loading}>
      {user && (
        <>
          <Link
            href="/body"
            className="card flex min-h-[56px] items-center justify-between gap-3 no-underline transition-transform active:translate-y-0.5"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-[var(--line)] bg-[var(--gold-bg)] text-[var(--ink)]">
                <Scale className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="font-marker text-base text-[var(--ink)]">
                  Body Weight ({kgToBodyDisplay(user.weightKg, unit)} {unit})
                </div>
                <div className="text-xs text-[var(--muted)]">
                  Log weight, view trend &amp; manage history on Body tab
                </div>
              </div>
            </div>
            <ChevronRight
              className="h-5 w-5 shrink-0 text-[var(--muted)]"
              aria-hidden="true"
            />
          </Link>

          <form onSubmit={handleSaveProfile} className="card flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-marker text-lg text-[var(--ink)]">
                Account Details
              </h2>
              <span className="font-mono text-xs text-[var(--muted)]">
                @{user.username}
              </span>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Name
              </span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                className="min-h-[44px] rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 text-base"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                  Height (cm)
                </span>
                <input
                  type="number"
                  step="0.5"
                  inputMode="decimal"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  className="min-h-[44px] rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 text-base"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                  Age
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className="min-h-[44px] rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 text-base"
                />
              </label>

              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                  Training Years
                </span>
                <input
                  type="number"
                  step="0.5"
                  inputMode="decimal"
                  value={trainingYears}
                  onChange={(e) => setTrainingYears(e.target.value)}
                  className="min-h-[44px] rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 text-base"
                />
              </label>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Unit
              </span>
              <div className="flex gap-1.5" role="group" aria-label="Weight unit">
                {(['kg', 'lb'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => handleUnitChange(u)}
                    className={`min-h-[44px] min-w-[54px] rounded-xl border-2 border-[var(--line)] px-3 font-bold ${
                      unit === u
                        ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                        : 'bg-[var(--card)] text-[var(--muted)]'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Timezone
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  required
                  className="min-h-[44px] w-full rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 text-base"
                />
                <Button
                  variant="alt"
                  onClick={() =>
                    setTimezone(
                      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                    )
                  }
                  className="min-h-[44px] shrink-0"
                >
                  Auto
                </Button>
              </div>
            </div>

            <Button
              type="submit"
              loading={saving}
              className="min-h-[44px] w-full"
            >
              Save Profile
            </Button>
          </form>

          <Button
            variant="red"
            loading={loggingOut}
            onClick={handleLogout}
            className="min-h-[44px] w-full justify-center gap-2"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </Button>
        </>
      )}
    </SettingsSubpageShell>
  );
}
