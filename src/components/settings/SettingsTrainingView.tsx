'use client';

import React, { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, Check, Clock, Focus, List, Timer } from 'lucide-react';
import { apiFetch, toast } from '@/components/ui';
import {
  ensureAlertServiceWorker,
  fireRestAlert,
  getRestAlertSupportInfo,
  requestRestAlertPermission,
  type RestAlertSupportInfo,
} from '@/lib/workouts/restAlerts';
import type { RestClockMode, WorkoutViewMode } from '@/types/domain';
import {
  DEFAULT_WEIGHT_STEP_KG,
  DEFAULT_WEIGHT_STEP_LB,
  displayStepToKg,
  KG_WEIGHT_STEP_OPTIONS,
  LB_WEIGHT_STEP_OPTIONS,
  stepKgToDisplay,
} from '@/lib/workouts/stepSize';
import { SettingsSubpageShell } from './SettingsSubpageShell';
import { type SettingsPayload, useSettingsData } from './useSettingsData';

const STATUS_BADGE: Record<
  RestAlertSupportInfo['status'],
  { label: string; className: string }
> = {
  allowed: {
    label: 'Allowed',
    className: 'bg-[var(--green-bg)] text-[var(--ink)]',
  },
  blocked: {
    label: 'Blocked',
    className: 'bg-[var(--red-bg)] text-[var(--ink)]',
  },
  prompt: {
    label: 'Permission needed',
    className: 'bg-[var(--gold-bg)] text-[var(--ink)]',
  },
  unsupported: {
    label: 'Not supported on this device',
    className: 'bg-[var(--surface-alt)] text-[var(--muted)]',
  },
};

export function SettingsTrainingView() {
  const { user, setUser, loading } = useSettingsData();
  const [savingMode, setSavingMode] = useState(false);
  const [savingWorkoutView, setSavingWorkoutView] = useState(false);
  const [savingWeightStep, setSavingWeightStep] = useState(false);
  const [alertInfo, setAlertInfo] = useState<RestAlertSupportInfo>(() =>
    getRestAlertSupportInfo(),
  );
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [testingAlert, setTestingAlert] = useState(false);
  const [testFeedback, setTestFeedback] = useState<string | null>(null);

  useEffect(() => {
    const info = getRestAlertSupportInfo();
    setAlertInfo(info);
    if (info.supportsServiceWorker && info.status !== 'unsupported') {
      void ensureAlertServiceWorker();
    }
  }, []);

  async function handleSelectRestMode(nextMode: RestClockMode) {
    if (!user || savingMode || user.restClockMode === nextMode) return;
    setSavingMode(true);
    try {
      const res = await apiFetch<SettingsPayload>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ restClockMode: nextMode }),
      });
      setUser(res.user);
      toast.success(
        nextMode === 'stopwatch'
          ? 'Rest clock set to Stopwatch'
          : 'Rest clock set to Countdown',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingMode(false);
    }
  }

  async function handleSelectWorkoutView(nextView: WorkoutViewMode) {
    if (!user || savingWorkoutView || user.defaultWorkoutView === nextView) return;
    setSavingWorkoutView(true);
    try {
      const res = await apiFetch<SettingsPayload>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ defaultWorkoutView: nextView }),
      });
      setUser(res.user);
      toast.success(
        nextView === 'focus'
          ? 'Default workout view set to Focus'
          : 'Default workout view set to List',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingWorkoutView(false);
    }
  }

  async function handleRequestPermission() {
    if (requestingPerm) return;
    setRequestingPerm(true);
    setTestFeedback(null);
    try {
      const updated = await requestRestAlertPermission();
      setAlertInfo(updated);
      if (updated.status === 'allowed') {
        toast.success('Notifications allowed');
      } else if (updated.status === 'blocked') {
        toast.error('Notifications blocked in browser');
      } else if (updated.status === 'unsupported') {
        toast.error('Notifications are not supported on this device');
      }
    } finally {
      setRequestingPerm(false);
    }
  }

  async function handleSendTestAlert() {
    if (testingAlert) return;
    setTestingAlert(true);
    try {
      const result = await fireRestAlert();
      const updated = getRestAlertSupportInfo();
      setAlertInfo(updated);

      if (result.notified && result.vibrated) {
        const msg = 'Test notification and vibration fired.';
        setTestFeedback(msg);
        toast.success(msg);
      } else if (result.notified) {
        const msg = updated.supportsVibration
          ? 'Test notification fired.'
          : 'Test notification fired (this device does not support vibration).';
        setTestFeedback(msg);
        toast.success('Test notification fired');
      } else if (result.vibrated) {
        const msg = `Device vibrated, but browser notification did not fire (${result.reason ?? 'not allowed'}).`;
        setTestFeedback(msg);
        toast.info('Vibrated (notifications off)');
      } else {
        const msg = `Alert did not fire (${result.reason ?? 'not supported on this device'}). In-app clock colour change still works.`;
        setTestFeedback(msg);
        toast.info('Notifications unavailable — colour change works in-app');
      }
    } finally {
      setTestingAlert(false);
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

  async function handleSelectDefaultWeightStep(nextStepKg: number | null) {
    if (!user || savingWeightStep) return;
    setSavingWeightStep(true);
    try {
      const res = await apiFetch<SettingsPayload>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ defaultWeightStepKg: nextStepKg }),
      });
      setUser(res.user);
      if (nextStepKg === null) {
        toast.success('Weight step reset to app default');
      } else {
        const label = stepKgToDisplay(nextStepKg, res.user.unit);
        toast.success(`Default weight step set to ±${label} ${res.user.unit}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingWeightStep(false);
    }
  }

  const badge = STATUS_BADGE[alertInfo.status];
  const weightStepOptions = user
    ? user.unit === 'lb'
      ? LB_WEIGHT_STEP_OPTIONS
      : KG_WEIGHT_STEP_OPTIONS
    : KG_WEIGHT_STEP_OPTIONS;
  const activeWeightStepDisplay = user
    ? stepKgToDisplay(user.defaultWeightStepKg, user.unit)
    : DEFAULT_WEIGHT_STEP_KG;

  return (
    <SettingsSubpageShell title="Training" user={user} loading={loading}>
      {user && (
        <div className="space-y-4">
          {/* Default Workout View */}
          <section id="workout-view" className="card space-y-3">
            <div>
              <h2 className="font-marker text-base text-[var(--ink)]">
                Default Workout View
              </h2>
              <p className="mt-0.5 text-sm text-[var(--muted)]">
                Choose the default view when starting a new workout. You can
                still switch between List and Focus mid-workout.
              </p>
            </div>

            <div
              role="radiogroup"
              aria-label="Default workout view"
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              <button
                type="button"
                role="radio"
                aria-checked={user.defaultWorkoutView === 'list'}
                disabled={savingWorkoutView}
                onClick={() => handleSelectWorkoutView('list')}
                className={`flex min-h-[56px] items-center gap-3 rounded-xl border-[2.5px] border-[var(--line)] p-3 text-left transition ${
                  user.defaultWorkoutView === 'list'
                    ? 'bg-[var(--gold-bg)] shadow-[2px_2px_0_var(--shadow-color)]'
                    : 'bg-[var(--surface-alt)]/60 opacity-80'
                }`}
              >
                <List className="h-5 w-5 shrink-0 text-[var(--ink)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-bold text-[var(--ink)]">
                    <span>List</span>
                    {user.defaultWorkoutView === 'list' && (
                      <Check className="h-4 w-4 shrink-0 text-[var(--green)]" />
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    All exercises in one scrolling list
                  </p>
                </div>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={user.defaultWorkoutView === 'focus'}
                disabled={savingWorkoutView}
                onClick={() => handleSelectWorkoutView('focus')}
                className={`flex min-h-[56px] items-center gap-3 rounded-xl border-[2.5px] border-[var(--line)] p-3 text-left transition ${
                  user.defaultWorkoutView === 'focus'
                    ? 'bg-[var(--gold-bg)] shadow-[2px_2px_0_var(--shadow-color)]'
                    : 'bg-[var(--surface-alt)]/60 opacity-80'
                }`}
              >
                <Focus className="h-5 w-5 shrink-0 text-[var(--ink)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-bold text-[var(--ink)]">
                    <span>Focus</span>
                    {user.defaultWorkoutView === 'focus' && (
                      <Check className="h-4 w-4 shrink-0 text-[var(--green)]" />
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    One exercise per screen with swipe &amp; inline rest
                  </p>
                </div>
              </button>
            </div>
          </section>

          {/* Rest Clock Mode */}
          <section id="rest-clock" className="card space-y-3">
            <div>
              <h2 className="font-marker text-base text-[var(--ink)]">
                Rest Clock Mode
              </h2>
              <p className="mt-0.5 text-sm text-[var(--muted)]">
                Choose how the rest timer runs after you complete a set.
              </p>
            </div>

            <div
              role="radiogroup"
              aria-label="Rest clock mode"
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              <button
                type="button"
                role="radio"
                aria-checked={user.restClockMode === 'stopwatch'}
                disabled={savingMode}
                onClick={() => handleSelectRestMode('stopwatch')}
                className={`flex min-h-[56px] items-center gap-3 rounded-xl border-[2.5px] border-[var(--line)] p-3 text-left transition ${
                  user.restClockMode === 'stopwatch'
                    ? 'bg-[var(--gold-bg)] shadow-[2px_2px_0_var(--shadow-color)]'
                    : 'bg-[var(--surface-alt)]/60 opacity-80'
                }`}
              >
                <Clock className="h-5 w-5 shrink-0 text-[var(--ink)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-bold text-[var(--ink)]">
                    <span>Stopwatch</span>
                    {user.restClockMode === 'stopwatch' && (
                      <Check className="h-4 w-4 shrink-0 text-[var(--green)]" />
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    Counts up from 0:00 past target
                  </p>
                </div>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={user.restClockMode === 'countdown'}
                disabled={savingMode}
                onClick={() => handleSelectRestMode('countdown')}
                className={`flex min-h-[56px] items-center gap-3 rounded-xl border-[2.5px] border-[var(--line)] p-3 text-left transition ${
                  user.restClockMode === 'countdown'
                    ? 'bg-[var(--gold-bg)] shadow-[2px_2px_0_var(--shadow-color)]'
                    : 'bg-[var(--surface-alt)]/60 opacity-80'
                }`}
              >
                <Timer className="h-5 w-5 shrink-0 text-[var(--ink)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-bold text-[var(--ink)]">
                    <span>Countdown</span>
                    {user.restClockMode === 'countdown' && (
                      <Check className="h-4 w-4 shrink-0 text-[var(--green)]" />
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    Counts down from target to 0:00
                  </p>
                </div>
              </button>
            </div>
          </section>

          {/* Rest Alerts */}
          <section id="rest-alerts" className="card space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="font-marker text-base text-[var(--ink)]">
                  Rest Alerts
                </h2>
                <p className="mt-0.5 text-sm text-[var(--muted)]">
                  Alert fired when your rest clock reaches its target.
                </p>
              </div>
              <span
                className={`inline-flex min-h-[28px] items-center gap-1.5 rounded-lg border-2 border-[var(--line)] px-2.5 py-0.5 text-xs font-bold ${badge.className}`}
              >
                {alertInfo.status === 'allowed' ? (
                  <BellRing className="h-3.5 w-3.5" />
                ) : alertInfo.status === 'blocked' ||
                  alertInfo.status === 'unsupported' ? (
                  <BellOff className="h-3.5 w-3.5" />
                ) : (
                  <Bell className="h-3.5 w-3.5" />
                )}
                <span>{badge.label}</span>
              </span>
            </div>

            {alertInfo.status === 'blocked' && (
              <div className="note text-sm text-[var(--ink)]">
                <p className="font-bold">How to re-enable notifications:</p>
                <p className="mt-1">
                  Open your browser&apos;s site settings (tap the lock or
                  settings icon next to the address bar), change{' '}
                  <strong>Notifications</strong> from Block to{' '}
                  <strong>Allow</strong>, then reload this page.
                </p>
              </div>
            )}

            {alertInfo.status === 'unsupported' && (
              <div className="note text-sm text-[var(--ink)]">
                {alertInfo.isIos && !alertInfo.isStandalone ? (
                  <p>
                    Notifications are <strong>not supported on this device</strong>{' '}
                    in a regular Safari tab. On iPhone or iPad, add LiftItUp to
                    your Home Screen (Share → Add to Home Screen) to enable
                    notifications. Safari has no vibration, and the rest clock
                    changing colour when you return to the app is always
                    guaranteed.
                  </p>
                ) : (
                  <p>
                    Notifications are <strong>not supported on this device</strong>{' '}
                    or browser context. The rest clock changing colour inside
                    the app when your target is reached is always guaranteed.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={
                  requestingPerm ||
                  alertInfo.status === 'allowed' ||
                  alertInfo.status === 'unsupported'
                }
                onClick={handleRequestPermission}
                className={`btn min-h-[44px] flex-1 text-sm ${
                  alertInfo.status === 'prompt' ? '' : 'alt'
                }`}
              >
                <Bell className="h-4 w-4 shrink-0" />
                <span>
                  {alertInfo.status === 'allowed'
                    ? 'Permission allowed'
                    : alertInfo.status === 'blocked'
                      ? 'Permission blocked'
                      : alertInfo.status === 'unsupported'
                        ? 'Not supported on this device'
                        : requestingPerm
                          ? 'Requesting…'
                          : 'Allow notifications'}
                </span>
              </button>

              <button
                type="button"
                disabled={testingAlert}
                onClick={handleSendTestAlert}
                className="btn alt min-h-[44px] flex-1 text-sm"
              >
                <BellRing className="h-4 w-4 shrink-0" />
                <span>{testingAlert ? 'Sending…' : 'Send test alert'}</span>
              </button>
            </div>

            {testFeedback && (
              <p className="rounded-lg border-2 border-[var(--line)] bg-[var(--surface-alt)] px-3 py-2 text-xs font-bold text-[var(--ink)]">
                {testFeedback}
              </p>
            )}

            <p className="text-xs text-[var(--muted)]">
              {alertInfo.isIos
                ? 'iOS Safari has no vibration, and alerts do not fire while the phone is locked without push. Returning to the app always shows the colour change.'
                : 'Alerts fire when the app is open; nothing fires while a phone is locked without push notifications. The colour change in-app is always guaranteed.'}
            </p>
          </section>

          {/* Default Weight Step */}
          <section id="weight-step" className="card space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="font-marker text-base text-[var(--ink)]">
                  Default Weight Step
                </h2>
                <p className="mt-0.5 text-sm text-[var(--muted)]">
                  Fallback increment for the +/− weight steppers when an
                  exercise has no custom step.
                </p>
              </div>
              <span className="pill gold shrink-0 text-xs">
                ±{activeWeightStepDisplay} {user.unit}
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label="Default weight step"
              className="flex flex-wrap gap-2"
            >
              {weightStepOptions.map((option) => {
                const selected = activeWeightStepDisplay === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={savingWeightStep}
                    onClick={() =>
                      void handleSelectDefaultWeightStep(
                        displayStepToKg(option, user.unit),
                      )
                    }
                    className={`min-h-[44px] min-w-[72px] rounded-xl border-[2.5px] border-[var(--line)] px-3 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] transition ${
                      selected
                        ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                        : 'bg-[var(--card)] text-[var(--ink)]'
                    }`}
                  >
                    ±{option} {user.unit}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-[var(--muted)]">
                {user.defaultWeightStepKg === null
                  ? `Using app default (±${
                      user.unit === 'lb'
                        ? DEFAULT_WEIGHT_STEP_LB
                        : DEFAULT_WEIGHT_STEP_KG
                    } ${user.unit}).`
                  : 'Custom global default active.'}
              </p>
              {user.defaultWeightStepKg !== null && (
                <button
                  type="button"
                  disabled={savingWeightStep}
                  onClick={() => void handleSelectDefaultWeightStep(null)}
                  className="btn alt !min-h-[44px] !px-3 text-xs"
                >
                  Reset to default
                </button>
              )}
            </div>
          </section>

          {/* Execution Quality % */}
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
        </div>
      )}
    </SettingsSubpageShell>
  );
}
