'use client';

import { useEffect, useRef, useState } from 'react';
import {
  computeRestClockState,
  shouldFireRestAlert,
  type DraftRestClock,
  type RestClockComputedState,
} from '@/lib/workouts/clock';
import { ensureAlertServiceWorker, fireRestAlert } from '@/lib/workouts/restAlerts';

/**
 * Shared live rest-clock ticker and alert trigger used by both
 * `FloatingRestTimer` (List mode) and the inline rest clock (Focus mode).
 */
export function useRestClockState(params: {
  restClock: DraftRestClock | null | undefined;
  onAlertFired: (startedAt: string) => void;
  enabled?: boolean;
}): {
  nowMs: number;
  state: RestClockComputedState;
  isClockActive: boolean;
} {
  const { restClock, onAlertFired, enabled = true } = params;
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const firedKeyRef = useRef<string | null>(null);

  const isClockActive = Boolean(restClock?.isActive);
  const clockStartedAt = restClock?.startedAt ?? null;
  const clockTargetSeconds = restClock?.targetSeconds ?? 0;
  const clockLabel = restClock?.label ?? '';
  const clockAlertFired = Boolean(restClock?.alertFired);

  useEffect(() => {
    if (!enabled || !isClockActive || !clockStartedAt) {
      firedKeyRef.current = null;
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
    enabled,
    isClockActive,
    clockStartedAt,
    clockTargetSeconds,
    clockLabel,
    clockAlertFired,
    restClock,
    onAlertFired,
  ]);

  return {
    nowMs,
    state: computeRestClockState(restClock, nowMs),
    isClockActive,
  };
}
