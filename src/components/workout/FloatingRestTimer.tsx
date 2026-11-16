'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Play,
  Timer,
  X,
} from 'lucide-react';
import {
  computeRestClockState,
  formatClockSeconds,
  shouldFireRestAlert,
  type DraftRestClock,
} from '@/lib/workouts/clock';
import { ensureAlertServiceWorker, fireRestAlert } from '@/lib/workouts/restAlerts';
import type { RestClockMode } from '@/types/domain';

export interface FloatingRestTimerProps {
  restClock: DraftRestClock | null | undefined;
  preferredMode: RestClockMode;
  isExpandedPicker?: boolean;
  onAdjustTarget: (deltaSeconds: number) => void;
  onStartPreset: (seconds: number, label?: string) => void;
  onStopForNextSet: () => void;
  onDismiss: () => void;
  onAlertFired: (startedAt: string) => void;
}

export default function FloatingRestTimer({
  restClock,
  preferredMode,
  isExpandedPicker = false,
  onAdjustTarget,
  onStartPreset,
  onStopForNextSet,
  onDismiss,
  onAlertFired,
}: FloatingRestTimerProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [minimized, setMinimized] = useState(false);
  const firedKeyRef = useRef<string | null>(null);

  const isClockActive = Boolean(restClock?.isActive);
  const clockStartedAt = restClock?.startedAt ?? null;
  const clockTargetSeconds = restClock?.targetSeconds ?? 0;
  const clockLabel = restClock?.label ?? '';
  const clockAlertFired = Boolean(restClock?.alertFired);

  useEffect(() => {
    if (!isClockActive || !clockStartedAt) {
      firedKeyRef.current = null;
      setMinimized(false);
      return;
    }

    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      void ensureAlertServiceWorker();
    }

    const runCheck = () => {
      const current = Date.now();
      setNowMs(current);

      if (!restClock) return;
      const fireKey = `${clockStartedAt}:${clockTargetSeconds}`;
      if (
        !clockAlertFired &&
        firedKeyRef.current !== fireKey &&
        shouldFireRestAlert(restClock, current)
      ) {
        firedKeyRef.current = fireKey;
        onAlertFired(clockStartedAt);
        void fireRestAlert({
          title: 'Rest done',
          body: clockLabel ? `Next set: ${clockLabel}` : 'Ready for next set',
        });
      }
    };

    runCheck();
    const interval = window.setInterval(runCheck, 250);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        runCheck();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', runCheck);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', runCheck);
    };
  }, [
    isClockActive,
    clockStartedAt,
    clockTargetSeconds,
    clockLabel,
    clockAlertFired,
    restClock,
    onAlertFired,
  ]);

  if (!isClockActive && !isExpandedPicker) {
    return null;
  }

  const state = computeRestClockState(restClock, nowMs);
  const isStopwatch = state.mode === 'stopwatch';
  const primaryReadout = isStopwatch
    ? formatClockSeconds(state.elapsedSeconds)
    : state.targetReached
      ? 'GO!'
      : formatClockSeconds(Math.ceil(state.remainingSeconds));

  if (isClockActive && minimized) {
    return (
      <div
        className="fixed right-3 z-40"
        style={{
          bottom: 'calc(var(--tabbar) + var(--sab) + 10px)',
        }}
      >
        <button
          type="button"
          onClick={() => setMinimized(false)}
          aria-label="Expand rest clock"
          className={`btn !min-h-[44px] !px-3.5 !py-1.5 ${
            state.targetReached ? 'green animate-pulse' : ''
          }`}
        >
          {state.targetReached ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : isStopwatch ? (
            <Clock className="h-4 w-4 shrink-0" />
          ) : (
            <Timer className="h-4 w-4 shrink-0" />
          )}
          <span className="font-marker text-lg tracking-wider">
            {primaryReadout}
          </span>
          <ChevronUp className="h-4 w-4 shrink-0" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed left-3 right-3 z-40 mx-auto max-w-xl"
      style={{
        bottom: 'calc(var(--tabbar) + var(--sab) + 10px)',
      }}
    >
      <div
        className={`card-sm border-[3px] border-[var(--line)] transition-colors duration-150 ${
          isClockActive && state.targetReached
            ? 'bg-[var(--green-bg)]'
            : 'bg-[var(--card)]'
        }`}
        style={{
          boxShadow: '5px 5px 0 var(--shadow-color)',
        }}
      >
        {!isClockActive && isExpandedPicker ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {preferredMode === 'stopwatch' ? (
                    <Clock className="h-5 w-5 shrink-0 text-[var(--red)]" />
                  ) : (
                    <Timer className="h-5 w-5 shrink-0 text-[var(--red)]" />
                  )}
                  <span className="font-marker text-lg">
                    {preferredMode === 'stopwatch'
                      ? 'Rest Stopwatch'
                      : 'Rest Timer'}
                  </span>
                </div>
                {preferredMode === 'stopwatch' && (
                  <p className="text-xs font-bold text-[var(--muted)]">
                    Pick target &amp; start counting up
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Close rest timer"
                className="btn icon alt !h-[44px] !w-[44px] shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[60, 90, 120, 180].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => onStartPreset(sec, 'Rest')}
                  className="btn !min-h-[44px] !px-2 text-base"
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Top row: Readout + Minimize & Dismiss */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[2.5px] border-[var(--line)] ${
                    state.targetReached
                      ? 'animate-pulse bg-[var(--green)] text-[var(--btn-red-fg)]'
                      : 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                  }`}
                >
                  {state.targetReached ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : isStopwatch ? (
                    <Clock className="h-5 w-5" />
                  ) : (
                    <Timer className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-marker text-2xl tracking-wider">
                      {primaryReadout}
                    </span>
                    <span className="pill px-2 py-0.5 text-xs">
                      {isStopwatch
                        ? state.targetReached
                          ? `Target ${formatClockSeconds(state.targetSeconds)} ✓`
                          : `Target ${formatClockSeconds(state.targetSeconds)}`
                        : state.targetReached
                          ? 'Ready'
                          : `${state.targetSeconds}s`}
                    </span>
                  </div>
                  {clockLabel && (
                    <p className="truncate text-sm font-bold text-[var(--muted)]">
                      {clockLabel}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  aria-label="Minimize rest clock"
                  className="btn alt icon !h-[44px] !w-[44px]"
                >
                  <ChevronDown className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label="Dismiss rest clock"
                  className="btn alt icon !h-[44px] !w-[44px]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Action row: Target +/- & Explicit Stop ("Next set") */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onAdjustTarget(-15)}
                aria-label="Decrease target rest by 15 seconds"
                className="btn alt !min-h-[44px] !min-w-[56px] !px-2.5 !py-1 text-sm"
              >
                −15s
              </button>
              <button
                type="button"
                onClick={() => onAdjustTarget(30)}
                aria-label="Increase target rest by 30 seconds"
                className="btn alt !min-h-[44px] !min-w-[56px] !px-2.5 !py-1 text-sm"
              >
                +30s
              </button>
              <button
                type="button"
                onClick={onStopForNextSet}
                aria-label="I'm starting my next set now"
                className={`btn !min-h-[44px] flex-1 !px-3 !py-1 text-base ${
                  state.targetReached ? 'green' : ''
                }`}
              >
                <Play className="h-4 w-4 shrink-0" />
                <span>Next set</span>
              </button>
            </div>

            <div className="bar !h-3">
              <div
                className={`bar-fill ${state.targetReached ? 'green' : 'gold'}`}
                style={{ width: `${state.targetReached ? 100 : state.progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
