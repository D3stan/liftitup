'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import { computeSteppedValue } from '@/lib/workouts/stepSize';

export interface NumberStepperProps {
  value: string;
  onChange: (nextValue: string) => void;
  step: number;
  min?: number;
  max?: number;
  fallbackValue?: number | null;
  inputMode?: 'decimal' | 'numeric';
  placeholder?: string;
  ariaLabel?: string;
  decrementLabel?: string;
  incrementLabel?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}

const HOLD_DELAY_MS = 380;
const HOLD_INTERVAL_MS = 90;

/**
 * Reusable numeric input with left (−) and right (+) hold-to-repeat stepper buttons.
 * Preserves freeform text editing, enforces >= 44px touch targets and >= 16px input font.
 */
export function NumberStepper({
  value,
  onChange,
  step,
  min = 0,
  max,
  fallbackValue = null,
  inputMode = 'decimal',
  placeholder = '0',
  ariaLabel,
  decrementLabel = 'Decrease',
  incrementLabel = 'Increase',
  disabled = false,
  className = '',
  inputClassName = '',
}: NumberStepperProps) {
  const latestValueRef = useRef(value);
  latestValueRef.current = value;

  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopHold = useCallback(() => {
    if (holdTimeoutRef.current !== null) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    if (holdIntervalRef.current !== null) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onWindowRelease = () => stopHold();
    window.addEventListener('pointerup', onWindowRelease);
    window.addEventListener('pointercancel', onWindowRelease);
    window.addEventListener('blur', onWindowRelease);
    return () => {
      stopHold();
      window.removeEventListener('pointerup', onWindowRelease);
      window.removeEventListener('pointercancel', onWindowRelease);
      window.removeEventListener('blur', onWindowRelease);
    };
  }, [stopHold]);

  const applyStep = useCallback(
    (direction: 1 | -1) => {
      if (disabled) return;
      const next = computeSteppedValue({
        currentRaw: latestValueRef.current,
        direction,
        step,
        min,
        max,
        fallbackValue,
      });
      latestValueRef.current = next;
      onChange(next);
    },
    [disabled, fallbackValue, max, min, onChange, step],
  );

  const handlePointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    direction: 1 | -1,
  ) => {
    if (disabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopHold();
    applyStep(direction);
    holdTimeoutRef.current = setTimeout(() => {
      holdIntervalRef.current = setInterval(() => {
        applyStep(direction);
      }, HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  };

  const handleButtonClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    direction: 1 | -1,
  ) => {
    // Only handle keyboard-triggered clicks (Enter/Space); pointer clicks already stepped on pointerDown.
    if (e.detail === 0) {
      applyStep(direction);
    }
  };

  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-label={decrementLabel}
        onPointerDown={(e) => handlePointerDown(e, -1)}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        onLostPointerCapture={stopHold}
        onClick={(e) => handleButtonClick(e, -1)}
        className="stepper-btn shrink-0 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>

      <input
        type="text"
        inputMode={inputMode}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          latestValueRef.current = e.target.value;
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`min-h-[44px] min-w-0 flex-1 rounded-[8px] border-[2.5px] border-[var(--line)] bg-[var(--card)] px-2 text-center text-base font-bold outline-none focus:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60 ${inputClassName}`}
      />

      <button
        type="button"
        disabled={disabled}
        aria-label={incrementLabel}
        onPointerDown={(e) => handlePointerDown(e, 1)}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        onLostPointerCapture={stopHold}
        onClick={(e) => handleButtonClick(e, 1)}
        className="stepper-btn shrink-0 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
