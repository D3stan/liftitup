'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button, apiFetch, toast } from '@/components/ui';
import type { UserProfile, WeightUnit } from '@/types/domain';
import { SettingsSubpageShell } from './SettingsSubpageShell';
import { type SettingsPayload, useSettingsData } from './useSettingsData';

function kgToDisplay(kg: number, unit: WeightUnit): string {
  const val = unit === 'lb' ? kg * 2.20462 : kg;
  return String(Math.round(val * 10) / 10);
}

function displayToKg(val: number, unit: WeightUnit): number {
  const kg = unit === 'lb' ? val / 2.20462 : val;
  return Math.round(kg * 10) / 10;
}

export function SettingsProfileView() {
  const { user, setUser, setApiKeyInfo, loading, loggingOut, handleLogout } =
    useSettingsData();
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weightInput, setWeightInput] = useState('');
  const [age, setAge] = useState('');
  const [trainingYears, setTrainingYears] = useState('');
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [timezone, setTimezone] = useState('UTC');

  const syncForm = useCallback((u: UserProfile) => {
    setDisplayName(u.displayName);
    setHeightCm(u.heightCm !== null ? String(u.heightCm) : '');
    setWeightInput(kgToDisplay(u.weightKg, u.unit));
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
    const parsed = Number(weightInput);
    if (Number.isFinite(parsed) && parsed > 0) {
      const kg = displayToKg(parsed, unit);
      setWeightInput(kgToDisplay(kg, nextUnit));
    }
    setUnit(nextUnit);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const parsedWeight = Number(weightInput);
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      toast.error('Invalid weight');
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch<SettingsPayload>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: displayName.trim(),
          heightCm: heightCm.trim() ? Number(heightCm) : null,
          weightKg: displayToKg(parsedWeight, unit),
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
                  Weight ({unit})
                </span>
                <input
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)}
                  required
                  className="min-h-[44px] rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 text-base"
                />
              </label>

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

              <label className="flex flex-col gap-1">
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
