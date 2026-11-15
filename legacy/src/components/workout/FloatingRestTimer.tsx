'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Timer, X, CheckCircle2, Volume2 } from 'lucide-react';
import { playMechanicalClick, playRestTimerDone } from '@/lib/audio/soundEngine';

export interface FloatingRestTimerProps {
  endTimeMs: number | null;
  totalSeconds: number;
  label?: string;
  soundEnabled: boolean;
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
  soundEnabled,
  isExpandedPicker = false,
  onAdjustSeconds,
  onStartPreset,
  onDismiss,
}: FloatingRestTimerProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const firedDoneRef = useRef<number | null>(null);

  useEffect(() => {
    if (!endTimeMs) {
      firedDoneRef.current = null;
      return;
    }

    setNowMs(Date.now());
    const interval = window.setInterval(() => {
      const current = Date.now();
      setNowMs(current);

      if (current >= endTimeMs && firedDoneRef.current !== endTimeMs) {
        firedDoneRef.current = endTimeMs;
        playRestTimerDone(soundEnabled);
      }
    }, 200);

    return () => window.clearInterval(interval);
  }, [endTimeMs, soundEnabled]);

  if (!endTimeMs && !isExpandedPicker) {
    return null;
  }

  const remainingSec = endTimeMs ? Math.max(0, (endTimeMs - nowMs) / 1000) : 0;
  const isFinished = Boolean(endTimeMs && remainingSec <= 0);
  const progressPct =
    endTimeMs && totalSeconds > 0
      ? Math.min(100, Math.max(0, ((totalSeconds - remainingSec) / totalSeconds) * 100))
      : 0;

  return (
    <div
      className="fixed left-3 right-3 z-40 mx-auto max-w-xl"
      style={{
        bottom: 'calc(var(--tabbar) + var(--sab) + 10px)',
      }}
    >
      <div
        className={`card-sm border-[3px] border-[#1d1a16] transition-transform duration-150 ${
          isFinished ? 'bg-[#cde6c0]' : 'bg-[#fbf5e4]'
        }`}
        style={{
          boxShadow: '5px 5px 0 var(--ink)',
        }}
      >
        {!endTimeMs && isExpandedPicker ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Timer className="w-5 h-5 text-[#d9412b]" />
                <span className="font-marker text-lg">
                  QUICK REST TIMER (WALL-CLOCK)
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  playMechanicalClick(soundEnabled);
                  onDismiss();
                }}
                aria-label="Close rest timer"
                className="btn icon alt !w-[44px] !h-[44px]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[60, 90, 120, 180].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => {
                    playMechanicalClick(soundEnabled);
                    onStartPreset(sec, 'Custom Rest');
                  }}
                  className="btn !min-h-[44px] !px-2 text-base"
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-10 h-10 rounded-full border-[2.5px] border-[#1d1a16] flex items-center justify-center shrink-0 ${
                    isFinished ? 'bg-[#2e7d3a] text-white' : 'bg-[#f2b632]'
                  }`}
                >
                  {isFinished ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <Timer className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-marker text-2xl tracking-wider">
                      {isFinished ? 'GO LIFT!' : formatClock(remainingSec)}
                    </span>
                    <span className="pill text-xs py-0.5 px-2">
                      {isFinished ? (
                        <span className="inline-flex items-center gap-1 text-[#2e7d3a]">
                          <Volume2 className="w-3.5 h-3.5" /> Ready
                        </span>
                      ) : (
                        `/${totalSeconds}s`
                      )}
                    </span>
                  </div>
                  <p className="text-sm text-[#5d5446] truncate font-bold">
                    {isFinished
                      ? `ATP-PCr replenished — hit your next set of ${label || 'working set'}!`
                      : `Resting: ${label || 'Working Set'}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    playMechanicalClick(soundEnabled);
                    onAdjustSeconds(-15);
                  }}
                  className="btn alt !min-h-[44px] !min-w-[48px] !px-2.5 !py-1 text-base"
                >
                  −15s
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playMechanicalClick(soundEnabled);
                    onAdjustSeconds(30);
                  }}
                  className="btn alt !min-h-[44px] !min-w-[48px] !px-2.5 !py-1 text-base"
                >
                  +30s
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playMechanicalClick(soundEnabled);
                    onDismiss();
                  }}
                  className={`btn !min-h-[44px] !min-w-[54px] !px-3 !py-1 text-base ${
                    isFinished ? 'green' : 'red'
                  }`}
                >
                  {isFinished ? 'Done' : 'Skip'}
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
