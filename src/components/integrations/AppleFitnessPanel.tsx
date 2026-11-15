'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type {
  AnalyticsSummary,
  AppleHealthWorkout,
  UserProfile,
} from '@/types/domain';
import {
  Watch,
  HeartPulse,
  Flame,
  Clock,
  Scale,
  Copy,
  Check,
  Upload,
  Sparkles,
  EyeOff,
  CheckCircle2,
  RefreshCw,
  Smartphone,
} from 'lucide-react';

export interface AppleFitnessPanelProps {
  user: UserProfile;
  analytics: AnalyticsSummary | null;
  onRefresh: () => Promise<void>;
  onUserUpdated: (user: UserProfile) => void;
  onShowToast: (message: string) => void;
}

/**
 * Client-side parser for Apple Health XML (<Workout ... />), CSV, or JSON files.
 */
function parseAppleHealthFileContent(
  fileName: string,
  content: string,
  fallbackBodyweightKg: number
): Partial<AppleHealthWorkout>[] {
  const lower = fileName.toLowerCase();
  const parsedWorkouts: Partial<AppleHealthWorkout>[] = [];

  if (lower.endsWith('.json')) {
    try {
      const data = JSON.parse(content);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data.workouts)
        ? data.workouts
        : [data];
      for (const item of list) {
        parsedWorkouts.push({
          workoutType:
            item.workoutType || 'Traditional Strength Training',
          durationMinutes: Math.max(
            5,
            Math.round(Number(item.durationMinutes || item.duration || 52))
          ),
          activeCalories: Math.max(
            20,
            Math.round(Number(item.activeCalories || item.kcal || 380))
          ),
          avgHeartRate: item.avgHeartRate ? Number(item.avgHeartRate) : 128,
          maxHeartRate: item.maxHeartRate ? Number(item.maxHeartRate) : 164,
          bodyweightKg: item.bodyweightKg
            ? Number(item.bodyweightKg)
            : fallbackBodyweightKg,
          startedAt: item.startedAt || new Date().toISOString(),
          source: 'file_import',
        });
      }
      return parsedWorkouts;
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

    for (let i = 1; i < Math.min(lines.length, 25); i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = cols[idx] || '';
      });

      const workoutType =
        row.workouttype ||
        row.type ||
        row.activity ||
        'Traditional Strength Training';
      const durationMinutes = Math.max(
        5,
        Math.round(Number(row.durationminutes || row.duration || 50))
      );
      const activeCalories = Math.max(
        20,
        Math.round(Number(row.activecalories || row.calories || row.kcal || 360))
      );
      const avgHeartRate = Number(row.avgheartrate || row.avghr || 126) || 126;
      const maxHeartRate = Number(row.maxheartrate || row.maxhr || 162) || 162;
      const bodyweightKg =
        Number(row.bodyweightkg || row.weightkg || fallbackBodyweightKg) ||
        fallbackBodyweightKg;

      parsedWorkouts.push({
        workoutType,
        durationMinutes,
        activeCalories,
        avgHeartRate,
        maxHeartRate,
        bodyweightKg,
        startedAt: row.startedat || row.date || new Date().toISOString(),
        source: 'file_import',
      });
    }
    return parsedWorkouts;
  }

  // XML parser (<Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" ... />)
  const workoutRegex = /<Workout\s+([^>]+?)(?:\/>|>[\s\S]*?<\/Workout>)/gi;
  let match: RegExpExecArray | null;
  while ((match = workoutRegex.exec(content)) !== null) {
    const attrs = match[1];
    const typeMatch = attrs.match(/workoutActivityType="([^"]+)"/i);
    const rawType = typeMatch ? typeMatch[1] : 'TraditionalStrengthTraining';

    // Match strength or functional training or general workouts
    if (
      !rawType.toLowerCase().includes('strength') &&
      !rawType.toLowerCase().includes('functional') &&
      !rawType.toLowerCase().includes('cross') &&
      !rawType.toLowerCase().includes('traditional')
    ) {
      continue;
    }

    const durMatch = attrs.match(/duration="([\d.]+)"/i);
    const kcalMatch = attrs.match(/totalEnergyBurned="([\d.]+)"/i);
    const startMatch = attrs.match(/startDate="([^"]+)"/i);

    const friendlyType = rawType
      .replace(/^HKWorkoutActivityType/i, '')
      .replace(/([A-Z])/g, ' $1')
      .trim();

    parsedWorkouts.push({
      workoutType: friendlyType || 'Traditional Strength Training',
      durationMinutes: durMatch ? Math.round(Number(durMatch[1])) : 54,
      activeCalories: kcalMatch ? Math.round(Number(kcalMatch[1])) : 410,
      avgHeartRate: 129,
      maxHeartRate: 165,
      bodyweightKg: fallbackBodyweightKg,
      startedAt: startMatch
        ? new Date(startMatch[1]).toISOString()
        : new Date().toISOString(),
      source: 'file_import',
    });

    if (parsedWorkouts.length >= 20) break;
  }

  return parsedWorkouts;
}

export default function AppleFitnessPanel({
  user,
  analytics,
  onRefresh,
  onUserUpdated,
  onShowToast,
}: AppleFitnessPanelProps) {
  const [origin, setOrigin] = useState<string>('https://lift.0xpuddu.com');
  const [enabled, setEnabled] = useState<boolean>(user.appleFitnessEnabled);
  const [workouts, setWorkouts] = useState<AppleHealthWorkout[]>(
    analytics?.appleHealthWorkouts || []
  );
  const [toggling, setToggling] = useState<boolean>(false);
  const [simulating, setSimulating] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [copiedWebhook, setCopiedWebhook] = useState<boolean>(false);
  const [copiedPayload, setCopiedPayload] = useState<boolean>(false);
  const [simBodyweightKg, setSimBodyweightKg] = useState<string>(
    String(user.bodyweightKg || 78.5)
  );

  useEffect(() => {
    setEnabled(user.appleFitnessEnabled);
    setSimBodyweightKg(String(user.bodyweightKg || 78.5));
  }, [user.appleFitnessEnabled, user.bodyweightKg]);

  useEffect(() => {
    if (analytics?.appleHealthWorkouts) {
      setWorkouts(analytics.appleHealthWorkouts);
    }
  }, [analytics?.appleHealthWorkouts]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      setOrigin(window.location.origin);
    }
  }, []);

  const fetchAppleWorkouts = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/apple-health');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.workouts)) {
          setWorkouts(data.workouts);
        }
        if (typeof data.enabled === 'boolean') {
          setEnabled(data.enabled);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchAppleWorkouts();
  }, [fetchAppleWorkouts]);

  const webhookUrl = `${origin}/api/integrations/apple-health`;

  const shortcutPayloadJson = JSON.stringify(
    {
      workoutType: 'Traditional Strength Training',
      durationMinutes: 58,
      activeCalories: 418,
      avgHeartRate: 131,
      maxHeartRate: 168,
      bodyweightKg: Number(simBodyweightKg) || user.bodyweightKg,
      startedAt: new Date().toISOString(),
    },
    null,
    2
  );

  const handleToggleIntegration = async (nextEnabled: boolean) => {
    setToggling(true);
    try {
      const res = await fetch('/api/integrations/apple-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle',
          enabled: nextEnabled,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setEnabled(nextEnabled);
        if (data.user) {
          onUserUpdated(data.user);
        } else {
          onUserUpdated({ ...user, appleFitnessEnabled: nextEnabled });
        }
        onShowToast(
          nextEnabled
            ? 'Apple Fitness & Watch Integration enabled!'
            : 'Apple Fitness Integration hidden.'
        );
      }
    } catch {
      onShowToast('Failed to update Apple Fitness preference');
    } finally {
      setToggling(false);
    }
  };

  const handleSimulateSync = async () => {
    setSimulating(true);
    try {
      const bw = Number(simBodyweightKg) || user.bodyweightKg;
      const res = await fetch('/api/integrations/apple-health', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': user.apiKey,
        },
        body: JSON.stringify({
          workoutType: 'Traditional Strength Training',
          durationMinutes: 56,
          activeCalories: 424,
          avgHeartRate: 132,
          maxHeartRate: 169,
          bodyweightKg: bw,
          startedAt: new Date().toISOString(),
          source: 'shortcut_webhook',
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to sync Apple Watch workout');
      }

      const data = await res.json();
      if (Array.isArray(data.workouts)) {
        setWorkouts(data.workouts);
      }
      if (data.user) {
        onUserUpdated(data.user);
      }
      await onRefresh();
      onShowToast(
        `⌚ Apple Watch Workout Synced! +${
          data.xpAwarded || 35
        } XP (BW: ${bw}kg updated for Chin-up equivalence)`
      );
    } catch (err) {
      onShowToast(
        err instanceof Error ? err.message : 'Apple Watch sync failed'
      );
    } finally {
      setSimulating(false);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = parseAppleHealthFileContent(
        file.name,
        text,
        user.bodyweightKg
      );

      if (parsed.length === 0) {
        onShowToast(
          'No strength workouts found in file. Ensure XML/CSV/JSON contains workout records.'
        );
        return;
      }

      const res = await fetch('/api/integrations/apple-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workouts: parsed,
          source: 'file_import',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.workouts)) {
          setWorkouts(data.workouts);
        }
        if (data.user) {
          onUserUpdated(data.user);
        }
        await onRefresh();
        onShowToast(
          `Imported ${parsed.length} Apple Health workout(s)! +${
            data.xpAwarded || 35
          } XP`
        );
      }
    } catch {
      onShowToast('Failed to parse or upload Apple Health export file');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const handleCopyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhook(true);
      onShowToast('Copied Apple Health Webhook URL!');
      setTimeout(() => setCopiedWebhook(false), 2000);
    } catch {
      onShowToast('Could not copy URL automatically.');
    }
  };

  const handleCopyPayload = async () => {
    try {
      await navigator.clipboard.writeText(shortcutPayloadJson);
      setCopiedPayload(true);
      onShowToast('Copied iOS Shortcut JSON Body!');
      setTimeout(() => setCopiedPayload(false), 2000);
    } catch {
      onShowToast('Could not copy payload automatically.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Toggle & Status Banner */}
      <div className="hero-card space-y-2.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Watch className="w-6 h-6 text-[#1d1a16]" />
            <h2 className="text-xl font-marker">
              APPLE FITNESS &amp; WATCH TELEMETRY SYNC
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={toggling}
              onClick={() => handleToggleIntegration(true)}
              className={`btn !min-h-[38px] !px-3 !py-1 text-sm ${
                enabled ? 'green' : 'alt'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              Enable Apple Fitness
            </button>
            <button
              type="button"
              disabled={toggling}
              onClick={() => handleToggleIntegration(false)}
              className={`btn !min-h-[38px] !px-3 !py-1 text-sm ${
                !enabled ? 'red' : 'alt'
              }`}
            >
              <EyeOff className="w-4 h-4" />
              Skip / Hide
            </button>
          </div>
        </div>

        <p className="text-base leading-snug">
          Syncs <strong>Active Calories</strong>, <strong>Avg/Max Heart Rate</strong>,
          and <strong>Apple Health Bodyweight</strong> via a 1-minute iOS Shortcut
          Webhook or Export Importer. Synced bodyweight automatically recalibrates
          your <strong>Weighted Chin-up ↔ Pulley equivalence</strong>!
        </p>
      </div>

      {!enabled ? (
        <div className="card text-center space-y-3 py-6">
          <EyeOff className="w-8 h-8 mx-auto text-[#5d5446]" />
          <h3 className="text-lg font-marker">
            APPLE FITNESS INTEGRATION IS CURRENTLY HIDDEN
          </h3>
          <p className="text-sm text-[#5d5446] max-w-md mx-auto">
            No Apple Watch? No problem! LiftItUp runs 100% standalone. Tap below
            anytime if you want to re-enable Apple Watch telemetry &amp; iOS
            Shortcut sync.
          </p>
          <button
            type="button"
            onClick={() => handleToggleIntegration(true)}
            className="btn mx-auto"
          >
            <Watch className="w-4 h-4" />
            Enable Apple Fitness Integration
          </button>
        </div>
      ) : (
        <>
          {/* Synced Apple Watch Telemetry Strip */}
          <section className="card space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <HeartPulse className="w-5 h-5 text-[#d9412b]" />
                <h3 className="text-lg font-marker">
                  SYNCED APPLE WATCH TELEMETRY STRIP
                </h3>
              </div>
              <span className="pill green text-xs">
                +35 XP per Synced Session
              </span>
            </div>

            {workouts.length === 0 ? (
              <div className="card-sm text-sm text-[#5d5446]">
                No Apple Watch workouts synced yet. Tap{' '}
                <strong>Simulate Apple Watch Workout Sync</strong> below to test!
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {workouts.slice(0, 6).map((w) => (
                  <div
                    key={w.id}
                    className="card-sm space-y-1.5 flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="pill text-xs gold">
                        <Watch className="w-3 h-3" />
                        {w.source === 'shortcut_webhook'
                          ? 'iOS Shortcut'
                          : w.source === 'file_import'
                          ? 'Health Export'
                          : 'Apple Watch'}
                      </span>
                      <span className="text-xs font-bold text-[#5d5446]">
                        {new Date(w.startedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>

                    <div className="font-bold text-base leading-tight">
                      {w.workoutType}
                    </div>

                    <div className="grid grid-cols-2 gap-1 text-xs font-bold pt-1">
                      <div className="flex items-center gap-1 text-[#d9412b]">
                        <Flame className="w-3.5 h-3.5" />
                        {w.activeCalories} kcal
                      </div>
                      <div className="flex items-center gap-1 text-[#1d1a16]">
                        <Clock className="w-3.5 h-3.5" />
                        {w.durationMinutes} min
                      </div>
                      <div className="flex items-center gap-1 text-[#2e7d3a]">
                        <HeartPulse className="w-3.5 h-3.5" />
                        {w.avgHeartRate || 128} / {w.maxHeartRate || 164} bpm
                      </div>
                      {w.bodyweightKg && (
                        <div className="flex items-center gap-1 text-[#2b5fa8]">
                          <Scale className="w-3.5 h-3.5" />
                          {w.bodyweightKg} kg BW
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 1-Tap Simulate Apple Watch Workout Sync */}
            <div className="note space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-bold">
                  <strong>Test Live Webhook Now:</strong> Simulate an Apple Watch
                  Strength Workout completion (+35 XP &amp; live Bodyweight sync):
                </div>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="sim-bw-input"
                    className="text-xs font-bold text-[#5d5446]"
                  >
                    Synced BW (kg):
                  </label>
                  <input
                    id="sim-bw-input"
                    type="text"
                    inputMode="decimal"
                    value={simBodyweightKg}
                    onChange={(e) =>
                      setSimBodyweightKg(e.target.value.replace(',', '.'))
                    }
                    className="nb-input !w-20 !min-h-[36px] !py-1 !px-2 text-center font-marker"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={simulating}
                onClick={handleSimulateSync}
                className="btn big w-full"
              >
                {simulating ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Syncing Apple Watch Telemetry...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    ⌚ Simulate Apple Watch Workout Sync (+35 XP)
                  </>
                )}
              </button>
            </div>
          </section>

          {/* 1-Minute iOS Shortcut Automation Wizard */}
          <section className="card space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-[#2b5fa8]" />
                <h3 className="text-lg font-marker">
                  1-MINUTE iOS SHORTCUT AUTOMATION WIZARD
                </h3>
              </div>
              <span className="pill blue text-xs">
                Auto-Runs When Watch Workout Ends
              </span>
            </div>

            <ol className="text-sm space-y-1.5 list-decimal list-inside font-bold text-[#1d1a16]">
              <li>
                Open the <strong>Shortcuts</strong> app on your iPhone →{' '}
                <strong>Automation</strong> tab → <strong>+ New Automation</strong>.
              </li>
              <li>
                Select <strong>Apple Watch Workout</strong> → check{' '}
                <strong>&quot;Ends&quot;</strong> → choose{' '}
                <strong>Run Immediately</strong>.
              </li>
              <li>
                Add action <strong>Find Health Samples</strong> (Type: Workouts &amp;
                Body Mass, Limit: 1) → add action{' '}
                <strong>Get Contents of URL</strong> (`POST`).
              </li>
              <li>
                Paste the Webhook URL, Header (`x-api-key`), and JSON Body below:
              </li>
            </ol>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="card-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase text-[#5d5446]">
                    POST Webhook URL
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyWebhook}
                    className="btn !min-h-[32px] !px-2.5 !py-0.5 text-xs"
                  >
                    {copiedWebhook ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#2e7d3a]" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy URL
                      </>
                    )}
                  </button>
                </div>
                <div className="font-mono text-xs font-bold break-all">
                  {webhookUrl}
                </div>
              </div>

              <div className="card-sm space-y-1">
                <span className="text-xs font-bold uppercase text-[#5d5446]">
                  Request Header (`x-api-key`)
                </span>
                <div className="font-mono text-xs font-bold break-all">
                  x-api-key: {user.apiKey}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-[#5d5446]">
                  JSON Request Body Template:
                </span>
                <button
                  type="button"
                  onClick={handleCopyPayload}
                  className="btn alt !min-h-[32px] !px-2.5 !py-0.5 text-xs"
                >
                  {copiedPayload ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#2e7d3a]" />
                      Copied JSON
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy JSON Body
                    </>
                  )}
                </button>
              </div>
              <div className="card-sm bg-[#1d1a16] text-[#fbf5e4] overflow-x-auto">
                <pre className="text-xs font-mono leading-relaxed">
                  {shortcutPayloadJson}
                </pre>
              </div>
            </div>
          </section>

          {/* Apple Health Export File Importer (XML / CSV / JSON) */}
          <section className="card space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-[#2e7d3a]" />
                <h3 className="text-lg font-marker">
                  APPLE HEALTH EXPORT FILE IMPORTER (.XML / .CSV / .JSON)
                </h3>
              </div>
              <span className="pill text-xs">Client-Side Parser</span>
            </div>

            <p className="text-sm text-[#5d5446]">
              Have an Apple Health <code>export.xml</code>, Workout CSV, or JSON
              backup? Select it below to parse{' '}
              <code>HKWorkoutActivityTypeTraditionalStrengthTraining</code>{' '}
              entries client-side and link them to your LiftItUp notebook.
            </p>

            <label className="btn alt w-full cursor-pointer">
              <Upload className="w-5 h-5" />
              <span>
                {importing
                  ? 'Parsing & Uploading Workouts...'
                  : '📂 Choose Apple Health .xml, .csv, or .json File'}
              </span>
              <input
                type="file"
                accept=".xml,.csv,.json,text/xml,text/csv,application/json"
                onChange={handleFileImport}
                disabled={importing}
                className="hidden"
              />
            </label>
          </section>
        </>
      )}
    </div>
  );
}
