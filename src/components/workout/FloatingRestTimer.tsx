'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Timer, X } from 'lucide-react';

export interface FloatingRestTimerProps {
  endTimeMs: number | null;
  totalSeconds: number;
  label?: string;
  isExpandedPicker?: boolean;
  onAdjustSeconds: (deltaSeconds: number) => void;
  onStartPreset: (seconds: number, label?: string) => void;
  onDismiss: () => void;
}

function formatClock(secondsRemaining: number): string {
  const clamped = Math.max(0, Math.ceil(secondsRemaining));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function FloatingRestTimer({
  endTimeMs,
  totalSeconds,
  label,
  isExpandedPicker = false,
  onAdjustSeconds,
  onStartPreset,
  onDismiss,
}: FloatingRestTimerProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [minimized, setMinimized] = useState(false);
  const firedDoneRef = useRef<number | null>(null);

  useEffect(() => {
    if (!endTimeMs) {
      firedDoneRef.current = null;
      setMinimized(false);
      return;
    }

    setNowMs(Date.now());
    const interval = window.setInterval(() => {
      const current = Date.now();
      setNowMs(current);

      if (current >= endTimeMs && firedDoneRef.current !== endTimeMs) {
        firedDoneRef.current = endTimeMs;
        try {
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate([180, 90, 180]);
          }
          if (
            typeof Notification !== 'undefined' &&
            Notification.permission === 'granted'
          ) {
            new Notification('Rest done', {
              body: label ? `Next set: ${label}` : 'Ready for next set',
            });
          }
        } catch {
          // Ignore unsupported browser APIs
        }
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, [endTimeMs, label]);

  if (!endTimeMs && !isExpandedPicker) {
    return null;
  }

  const remainingSec = endTimeMs ? Math.max(0, (endTimeMs - nowMs) / 1000) : 0;
  const isFinished = Boolean(endTimeMs && remainingSec <= 0);
  const progressPct =
    endTimeMs && totalSeconds > 0
      ? Math.min(
          100,
          Math.max(0, ((totalSeconds - remainingSec) / totalSeconds) * 100),
        )
      : 0;

  if (endTimeMs && minimized) {
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
          aria-label="Expand rest timer"
          className={`btn !min-h-[44px] !px-3.5 !py-1.5 ${
            isFinished ? 'green animate-pulse' : ''
          }`}
        >
          {isFinished ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <Timer className="h-4 w-4 shrink-0" />
          )}
          <span className="font-marker text-lg tracking-wider">
            {isFinished ? 'GO!' : formatClock(remainingSec)}
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
          isFinished ? 'bg-[var(--green-bg)]' : 'bg-[var(--card)]'
        }`}
        style={{
          boxShadow: '5px 5px 0 var(--shadow-color)',
        }}
      >
        {!endTimeMs && isExpandedPicker ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Timer className="h-5 w-5 text-[var(--red)]" />
                <span className="font-marker text-lg">Rest Timer</span>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Close rest timer"
                className="btn icon alt !h-[44px] !w-[44px]"
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[2.5px] border-[var(--line)] ${
                    isFinished
                      ? 'animate-pulse bg-[var(--green)] text-[var(--btn-red-fg)]'
                      : 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                  }`}
                >
                  {isFinished ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <Timer className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-marker text-2xl tracking-wider">
                      {isFinished ? 'GO!' : formatClock(remainingSec)}
                    </span>
                    <span className="pill px-2 py-0.5 text-xs">
                      {isFinished ? 'Ready' : `${totalSeconds}s`}
                    </span>
                  </div>
                  {label && (
                    <p className="truncate text-sm font-bold text-[var(--muted)]">
                      {label}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onAdjustSeconds(-15)}
                  className="btn alt !min-h-[44px] !min-w-[48px] !px-2.5 !py-1 text-base"
                >
                  −15s
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustSeconds(30)}
                  className="btn alt !min-h-[44px] !min-w-[48px] !px-2.5 !py-1 text-base"
                >
                  +30s
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  className={`btn !min-h-[44px] !min-w-[54px] !px-3 !py-1 text-base ${
                    isFinished ? 'green' : 'red'
                  }`}
                >
                  {isFinished ? 'Done' : 'Skip'}
                </button>
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  aria-label="Minimize rest timer"
                  className="btn alt icon !h-[44px] !w-[44px]"
                >
                  <ChevronDown className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="bar !h-3">
              <div
                className={`bar-fill ${isFinished ? 'green' : 'gold'}`}
                style={{ width: `${isFinished ? 100 : progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
