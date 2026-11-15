'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Upload, Watch } from 'lucide-react';
import { Button, apiFetch, toast } from '@/components/ui';
import type { AppleHealthWorkout, UserProfile } from '@/types/domain';

interface AppleFitnessPanelProps {
  user: UserProfile;
  onUserUpdated: (user: UserProfile) => void;
}

interface ParsedWorkoutInput {
  workoutType: string;
  startedAt: string;
  durationMinutes: number;
  activeCalories: number;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  bodyweightKg: number | null;
  source: 'file_import';
}

function parseAppleHealthFile(
  fileName: string,
  content: string,
): ParsedWorkoutInput[] {
  const lower = fileName.toLowerCase();
  const results: ParsedWorkoutInput[] = [];

  if (lower.endsWith('.json')) {
    try {
      const data = JSON.parse(content) as unknown;
      const list = Array.isArray(data)
        ? data
        : data && typeof data === 'object' && Array.isArray((data as { workouts?: unknown }).workouts)
          ? (data as { workouts: unknown[] }).workouts
          : [data];
      for (const raw of list.slice(0, 25)) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        results.push({
          workoutType:
            typeof item.workoutType === 'string' && item.workoutType.trim()
              ? item.workoutType.trim()
              : 'Traditional Strength Training',
          startedAt:
            typeof item.startedAt === 'string' && item.startedAt.trim()
              ? item.startedAt.trim()
              : new Date().toISOString(),
          durationMinutes: Math.max(
            1,
            Math.round(Number(item.durationMinutes ?? item.duration ?? 50) || 50),
          ),
          activeCalories: Math.max(
            0,
            Math.round(Number(item.activeCalories ?? item.kcal ?? item.calories ?? 350) || 350),
          ),
          avgHeartRate: item.avgHeartRate ? Number(item.avgHeartRate) : null,
          maxHeartRate: item.maxHeartRate ? Number(item.maxHeartRate) : null,
          bodyweightKg:
            item.bodyweightKg !== undefined && item.bodyweightKg !== null
              ? Number(item.bodyweightKg)
              : null,
          source: 'file_import',
        });
      }
      return results;
    } catch {
      return [];
    }
  }

  if (lower.endsWith('.csv')) {
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());

    for (let i = 1; i < Math.min(lines.length, 26); i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = cols[idx] ?? '';
      });
      const bw = Number(row.bodyweightkg || row.weightkg || '');
      const avgHr = Number(row.avgheartrate || row.avghr || '');
      const maxHr = Number(row.maxheartrate || row.maxhr || '');
      results.push({
        workoutType:
          row.workouttype || row.type || row.activity || 'Traditional Strength Training',
        startedAt: row.startedat || row.date || new Date().toISOString(),
        durationMinutes: Math.max(
          1,
          Math.round(Number(row.durationminutes || row.duration || 50) || 50),
        ),
        activeCalories: Math.max(
          0,
          Math.round(Number(row.activecalories || row.calories || row.kcal || 350) || 350),
        ),
        avgHeartRate: Number.isFinite(avgHr) && avgHr > 0 ? avgHr : null,
        maxHeartRate: Number.isFinite(maxHr) && maxHr > 0 ? maxHr : null,
        bodyweightKg: Number.isFinite(bw) && bw >= 25 && bw <= 300 ? bw : null,
        source: 'file_import',
      });
    }
    return results;
  }

  // XML (<Workout ... />)
  const workoutRegex = /<Workout\s+([^>]+?)(?:\/>|>[\s\S]*?<\/Workout>)/gi;
  let match: RegExpExecArray | null;
  while ((match = workoutRegex.exec(content)) !== null) {
    const attrs = match[1];
    const typeMatch = attrs.match(/workoutActivityType="([^"]+)"/i);
    const rawType = typeMatch ? typeMatch[1] : 'TraditionalStrengthTraining';
    const durMatch = attrs.match(/duration="([\d.]+)"/i);
    const kcalMatch = attrs.match(/totalEnergyBurned="([\d.]+)"/i);
    const startMatch = attrs.match(/startDate="([^"]+)"/i);

    const friendlyType = rawType
      .replace(/^HKWorkoutActivityType/i, '')
      .replace(/([A-Z])/g, ' $1')
      .trim();

    results.push({
      workoutType: friendlyType || 'Traditional Strength Training',
      startedAt: startMatch
        ? new Date(startMatch[1]).toISOString()
        : new Date().toISOString(),
      durationMinutes: durMatch ? Math.max(1, Math.round(Number(durMatch[1]))) : 50,
      activeCalories: kcalMatch ? Math.max(0, Math.round(Number(kcalMatch[1]))) : 350,
      avgHeartRate: null,
      maxHeartRate: null,
      bodyweightKg: null,
      source: 'file_import',
    });

    if (results.length >= 25) break;
  }

  return results;
}

export function AppleFitnessPanel({
  user,
  onUserUpdated,
}: AppleFitnessPanelProps) {
  const [workouts, setWorkouts] = useState<AppleHealthWorkout[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const loadWorkouts = useCallback(async () => {
    try {
      const res = await apiFetch<{
        enabled: boolean;
        workouts: AppleHealthWorkout[];
      }>('/api/integrations/apple-health');
      setWorkouts(res.workouts);
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
        res.user.appleFitnessEnabled ? 'Apple Health enabled' : 'Apple Health paused',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      toast.success('Webhook URL copied');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Copy failed');
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parseAppleHealthFile(file.name, text);
      if (parsed.length === 0) {
        toast.error('No workouts found');
        return;
      }
      const res = await apiFetch<{
        syncedCount: number;
        user: UserProfile;
        workouts: AppleHealthWorkout[];
      }>('/api/integrations/apple-health', {
        method: 'POST',
        body: JSON.stringify({ source: 'file_import', workouts: parsed }),
      });
      onUserUpdated(res.user);
      setWorkouts(res.workouts);
      toast.success(`Imported ${res.syncedCount} workout(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Watch className="h-5 w-5 text-[#1d1a16]" />
          <h2 className="font-marker text-lg text-[#1d1a16]">Apple Health</h2>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={user.appleFitnessEnabled}
          disabled={busy}
          onClick={handleToggle}
          className={`min-h-[44px] min-w-[72px] rounded-xl border-2 border-[#1d1a16] px-3 text-sm font-bold transition ${
            user.appleFitnessEnabled
              ? 'bg-[#cde6c0] text-[#1d1a16]'
              : 'bg-[#e8dec1] text-[#6b6254]'
          }`}
        >
          {user.appleFitnessEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-[#6b6254]">
          Webhook URL
        </span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={webhookUrl}
            aria-label="Apple Health webhook URL"
            className="min-h-[44px] w-full rounded-xl border-2 border-[#1d1a16] bg-[#fffdf7] px-3 text-sm"
          />
          <Button
            variant="alt"
            size="icon"
            onClick={handleCopyUrl}
            aria-label="Copy webhook URL"
            className="min-h-[44px] min-w-[44px] shrink-0"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
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
      </div>

      {workouts.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-[#1d1a16]/15 pt-2">
          <span className="text-xs font-bold uppercase tracking-wide text-[#6b6254]">
            Recent Syncs
          </span>
          {workouts.slice(0, 5).map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between rounded-lg border border-[#1d1a16]/20 bg-[#fffdf7] px-2.5 py-1.5 text-sm"
            >
              <span className="truncate font-medium">{w.workoutType}</span>
              <span className="shrink-0 text-xs text-[#6b6254]">
                {w.durationMinutes}m · {w.activeCalories} kcal
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
