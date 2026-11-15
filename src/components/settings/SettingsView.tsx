'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Download, KeyRound, LogOut, RefreshCw } from 'lucide-react';
import { ApiClientError, Button, apiFetch, toast } from '@/components/ui';
import { AppleFitnessPanel } from '@/components/integrations/AppleFitnessPanel';
import type { ApiKeyInfo, UserProfile, WeightUnit } from '@/types/domain';

interface SettingsPayload {
  user: UserProfile;
  apiKey: ApiKeyInfo | null;
}

interface RegenerateKeyPayload {
  apiKey: string;
  keyPrefix: string;
  mcpUrl: string;
  apiKeyInfo: ApiKeyInfo;
}

function kgToDisplay(kg: number, unit: WeightUnit): string {
  const val = unit === 'lb' ? kg * 2.20462 : kg;
  return String(Math.round(val * 10) / 10);
}

function displayToKg(val: number, unit: WeightUnit): number {
  const kg = unit === 'lb' ? val / 2.20462 : val;
  return Math.round(kg * 10) / 10;
}

function formatMcpSnippet(mcpUrl: string, apiKey: string | null): string {
  const token = apiKey || '<YOUR_API_KEY>';
  return JSON.stringify(
    {
      mcpServers: {
        liftitup: {
          type: 'http',
          url: mcpUrl,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2,
  );
}

export function SettingsView() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [apiKeyInfo, setApiKeyInfo] = useState<ApiKeyInfo | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [regenBusy, setRegenBusy] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Profile form state
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
    setOrigin(window.location.origin);
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<SettingsPayload>('/api/settings');
        if (cancelled) return;
        setUser(res.user);
        setApiKeyInfo(res.apiKey);
        syncForm(res.user);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          router.replace('/welcome');
          return;
        }
        toast.error(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, syncForm]);

  async function copyText(id: string, text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast.success(`${label} copied`);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
    } catch {
      toast.error('Copy failed');
    }
  }

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
      toast.success('Profile saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

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

  async function handleRegenerateKey() {
    setRegenBusy(true);
    try {
      const res = await apiFetch<RegenerateKeyPayload>(
        '/api/settings/api-key',
        { method: 'POST' },
      );
      setRevealedKey(res.apiKey);
      setApiKeyInfo(res.apiKeyInfo);
      toast.success('New key created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to regenerate');
    } finally {
      setRegenBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      router.replace('/welcome');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Logout failed');
    }
  }

  if (loading || !user) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-28 pt-6">
        <h1 className="font-marker text-2xl text-[#1d1a16]">Settings</h1>
        <div className="card text-sm text-[#6b6254]">
          {loading ? 'Loading…' : 'Unavailable'}
        </div>
      </div>
    );
  }

  const mcpUrl = origin ? `${origin}/api/mcp` : '/api/mcp';
  const snippet = formatMcpSnippet(mcpUrl, revealedKey);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-28 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="font-marker text-2xl text-[#1d1a16]">Settings</h1>
        {user.isGuest && (
          <span className="rounded-lg border-2 border-[#1d1a16] bg-[#f2b632] px-2.5 py-0.5 text-xs font-bold">
            SAMPLE
          </span>
        )}
      </div>

      {/* Profile */}
      <form onSubmit={handleSaveProfile} className="card flex flex-col gap-3">
        <h2 className="font-marker text-lg text-[#1d1a16]">Profile</h2>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide text-[#6b6254]">
            Name
          </span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="min-h-[44px] rounded-xl border-2 border-[#1d1a16] bg-[#fffdf7] px-3 text-base"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-[#6b6254]">
              Weight ({unit})
            </span>
            <input
              type="number"
              step="0.1"
              inputMode="decimal"
              value={weightInput}
              onChange={(e) => setWeightInput(e.target.value)}
              required
              className="min-h-[44px] rounded-xl border-2 border-[#1d1a16] bg-[#fffdf7] px-3 text-base"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-[#6b6254]">
              Height (cm)
            </span>
            <input
              type="number"
              step="0.5"
              inputMode="decimal"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              className="min-h-[44px] rounded-xl border-2 border-[#1d1a16] bg-[#fffdf7] px-3 text-base"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-[#6b6254]">
              Age
            </span>
            <input
              type="number"
              inputMode="numeric"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className="min-h-[44px] rounded-xl border-2 border-[#1d1a16] bg-[#fffdf7] px-3 text-base"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-[#6b6254]">
              Training Years
            </span>
            <input
              type="number"
              step="0.5"
              inputMode="decimal"
              value={trainingYears}
              onChange={(e) => setTrainingYears(e.target.value)}
              className="min-h-[44px] rounded-xl border-2 border-[#1d1a16] bg-[#fffdf7] px-3 text-base"
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-[#6b6254]">
            Unit
          </span>
          <div className="flex gap-1.5" role="group" aria-label="Weight unit">
            {(['kg', 'lb'] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => handleUnitChange(u)}
                className={`min-h-[44px] min-w-[54px] rounded-xl border-2 border-[#1d1a16] px-3 font-bold ${
                  unit === u
                    ? 'bg-[#f2b632] text-[#1d1a16]'
                    : 'bg-[#fbf5e4] text-[#6b6254]'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide text-[#6b6254]">
            Timezone
          </span>
          <div className="flex gap-2">
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              required
              className="min-h-[44px] w-full rounded-xl border-2 border-[#1d1a16] bg-[#fffdf7] px-3 text-base"
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

        <Button type="submit" loading={saving} className="min-h-[44px] w-full">
          Save Profile
        </Button>
      </form>

      {/* Execution Quality Toggle */}
      <section className="card flex items-center justify-between gap-3">
        <span className="font-marker text-base text-[#1d1a16]">
          Execution Quality %
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={user.enableSetQuality}
          onClick={handleToggleSetQuality}
          className={`min-h-[44px] min-w-[72px] rounded-xl border-2 border-[#1d1a16] px-3 text-sm font-bold transition ${
            user.enableSetQuality
              ? 'bg-[#cde6c0] text-[#1d1a16]'
              : 'bg-[#e8dec1] text-[#6b6254]'
          }`}
        >
          {user.enableSetQuality ? 'ON' : 'OFF'}
        </button>
      </section>

      {/* MCP Section */}
      <section className="card flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-[#1d1a16]" />
          <h2 className="font-marker text-lg text-[#1d1a16]">MCP</h2>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide text-[#6b6254]">
            Endpoint
          </span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={mcpUrl}
              aria-label="MCP Endpoint"
              className="min-h-[44px] w-full rounded-xl border-2 border-[#1d1a16] bg-[#fffdf7] px-3 text-base"
            />
            <Button
              variant="alt"
              size="icon"
              onClick={() => copyText('mcp-url', mcpUrl, 'Endpoint')}
              aria-label="Copy MCP endpoint"
              className="min-h-[44px] min-w-[44px] shrink-0"
            >
              {copiedId === 'mcp-url' ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-xs font-bold uppercase tracking-wide text-[#6b6254]">
              API Key
            </span>
            <span className="font-mono text-sm">
              {apiKeyInfo ? `${apiKeyInfo.keyPrefix}••••` : 'None'}
            </span>
          </div>
          <Button
            variant="alt"
            loading={regenBusy}
            onClick={handleRegenerateKey}
            className="min-h-[44px] gap-1.5"
          >
            <RefreshCw className="h-4 w-4" />
            Regenerate
          </Button>
        </div>

        {revealedKey && (
          <div className="flex flex-col gap-1.5 rounded-xl border-2 border-[#1d1a16] bg-[#f2b632]/30 p-3">
            <span className="text-xs font-bold uppercase tracking-wide text-[#1d1a16]">
              Copy Key Now
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={revealedKey}
                aria-label="Generated API Key"
                className="min-h-[44px] w-full rounded-xl border-2 border-[#1d1a16] bg-[#fffdf7] px-3 font-mono text-base"
              />
              <Button
                variant="primary"
                size="icon"
                onClick={() => copyText('api-key', revealedKey, 'API key')}
                aria-label="Copy API key"
                className="min-h-[44px] min-w-[44px] shrink-0"
              >
                {copiedId === 'api-key' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-[#6b6254]">
              Client Config
            </span>
            <Button
              variant="alt"
              onClick={() => copyText('mcp-snippet', snippet, 'Config')}
              className="min-h-[44px] gap-1.5 px-3 text-sm"
            >
              {copiedId === 'mcp-snippet' ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Copy
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-xl border-2 border-[#1d1a16] bg-[#fffdf7] p-3 font-mono text-xs">
            {snippet}
          </pre>
        </div>
      </section>

      {/* Export */}
      <section className="card flex flex-col gap-3">
        <h2 className="font-marker text-lg text-[#1d1a16]">Export</h2>
        <div className="grid grid-cols-2 gap-3">
          <a
            href="/api/export?format=json"
            download
            className="btn alt min-h-[44px] justify-center gap-2 no-underline"
          >
            <Download className="h-4 w-4" />
            JSON
          </a>
          <a
            href="/api/export?format=csv"
            download
            className="btn alt min-h-[44px] justify-center gap-2 no-underline"
          >
            <Download className="h-4 w-4" />
            CSV
          </a>
        </div>
      </section>

      {/* Apple Health */}
      <AppleFitnessPanel user={user} onUserUpdated={setUser} />

      {/* Log out */}
      <Button
        variant="red"
        onClick={handleLogout}
        className="min-h-[44px] w-full justify-center gap-2"
      >
        <LogOut className="h-4 w-4" />
        Log out
      </Button>
    </div>
  );
}
