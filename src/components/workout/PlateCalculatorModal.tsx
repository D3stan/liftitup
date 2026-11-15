'use client';

import React, { useState, useMemo } from 'react';
import { X, Disc, Plus, Minus } from 'lucide-react';
import { playMechanicalClick } from '@/lib/audio/soundEngine';

export interface PlateCalculatorModalProps {
  isOpen: boolean;
  initialWeightKg?: number;
  soundEnabled: boolean;
  onClose: () => void;
  onApplyWeight?: (weightKg: number) => void;
}

interface PlateSpec {
  weightKg: number;
  label: string;
  fill: string;
  textColor: string;
  heightPx: number;
  widthPx: number;
}

const IPF_PLATES: PlateSpec[] = [
  {
    weightKg: 25,
    label: '25',
    fill: '#d9412b', // Red
    textColor: '#ffffff',
    heightPx: 118,
    widthPx: 26,
  },
  {
    weightKg: 20,
    label: '20',
    fill: '#2b5fa8', // Blue
    textColor: '#ffffff',
    heightPx: 114,
    widthPx: 24,
  },
  {
    weightKg: 15,
    label: '15',
    fill: '#f2b632', // Yellow/Gold
    textColor: '#1d1a16',
    heightPx: 100,
    widthPx: 22,
  },
  {
    weightKg: 10,
    label: '10',
    fill: '#2e7d3a', // Green
    textColor: '#ffffff',
    heightPx: 86,
    widthPx: 20,
  },
  {
    weightKg: 5,
    label: '5',
    fill: '#fbf5e4', // White
    textColor: '#1d1a16',
    heightPx: 70,
    widthPx: 18,
  },
  {
    weightKg: 2.5,
    label: '2.5',
    fill: '#1d1a16', // Black
    textColor: '#fbf5e4',
    heightPx: 58,
    widthPx: 16,
  },
  {
    weightKg: 1.25,
    label: '1.25',
    fill: '#b8b2a6', // Silver/Chrome
    textColor: '#1d1a16',
    heightPx: 48,
    widthPx: 14,
  },
];

const BAR_OPTIONS = [
  { weightKg: 20, label: '20kg Olympic Bar' },
  { weightKg: 15, label: '15kg Women / Technique Bar' },
  { weightKg: 10, label: '10kg EZ-Curl Bar' },
];

export default function PlateCalculatorModal({
  isOpen,
  initialWeightKg = 100,
  soundEnabled,
  onClose,
  onApplyWeight,
}: PlateCalculatorModalProps) {
  const [targetWeightKg, setTargetWeightKg] = useState<number>(
    initialWeightKg > 0 ? initialWeightKg : 100
  );
  const [barWeightKg, setBarWeightKg] = useState<number>(20);
  const [rawInput, setRawInput] = useState<string>(
    String(initialWeightKg > 0 ? initialWeightKg : 100)
  );

  React.useEffect(() => {
    if (isOpen && initialWeightKg && initialWeightKg > 0) {
      setTargetWeightKg(initialWeightKg);
      setRawInput(String(initialWeightKg));
    }
  }, [isOpen, initialWeightKg]);

  const breakdown = useMemo(() => {
    const clampedTarget = Math.max(barWeightKg, targetWeightKg);
    let perSideRemaining = Math.max(0, (clampedTarget - barWeightKg) / 2);

    const platesPerSide: { spec: PlateSpec; count: number }[] = [];
    const flatPlates: PlateSpec[] = [];

    for (const spec of IPF_PLATES) {
      const count = Math.floor((perSideRemaining + 0.001) / spec.weightKg);
      if (count > 0) {
        platesPerSide.push({ spec, count });
        for (let i = 0; i < Math.min(count, 8); i += 1) {
          flatPlates.push(spec);
        }
        perSideRemaining = Number(
          (perSideRemaining - count * spec.weightKg).toFixed(3)
        );
      }
    }

    const loadedPerSideKg = platesPerSide.reduce(
      (sum, p) => sum + p.spec.weightKg * p.count,
      0
    );
    const exactLoadedTotalKg = barWeightKg + loadedPerSideKg * 2;

    return {
      perSideKg: loadedPerSideKg,
      exactLoadedTotalKg,
      unmatchedRemainderKg: Number((perSideRemaining * 2).toFixed(2)),
      platesPerSide,
      flatPlates,
    };
  }, [targetWeightKg, barWeightKg]);

  if (!isOpen) return null;

  const adjustWeight = (delta: number) => {
    playMechanicalClick(soundEnabled);
    const next = Math.max(barWeightKg, Number((targetWeightKg + delta).toFixed(2)));
    setTargetWeightKg(next);
    setRawInput(String(next));
  };

  return (
    <div className="sheet-backdrop flex items-end justify-center" onClick={onClose}>
      <div
        className="sheet-panel max-w-xl mx-auto w-full space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="pill gold font-marker text-base">🧮 BARBELL LOADER</span>
            <h2 className="text-2xl font-marker">PLATE CALCULATOR</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              playMechanicalClick(soundEnabled);
              onClose();
            }}
            aria-label="Close plate calculator"
            className="btn icon alt"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Bar Selector */}
        <div className="space-y-1.5">
          <label className="text-sm font-bold text-[#5d5446] uppercase">
            1. Select Empty Barbell Weight
          </label>
          <div className="grid grid-cols-3 gap-2">
            {BAR_OPTIONS.map((bar) => {
              const active = barWeightKg === bar.weightKg;
              return (
                <button
                  key={bar.weightKg}
                  type="button"
                  onClick={() => {
                    playMechanicalClick(soundEnabled);
                    setBarWeightKg(bar.weightKg);
                    if (targetWeightKg < bar.weightKg) {
                      setTargetWeightKg(bar.weightKg);
                      setRawInput(String(bar.weightKg));
                    }
                  }}
                  className={`btn !px-2 !py-2 text-base ${active ? '' : 'alt'}`}
                >
                  {bar.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Target Weight Steppers & Input */}
        <div className="card-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-[#5d5446]">
              2. Target Total Barbell Weight (kg)
            </span>
            <span className="pill green text-sm">
              Per Side: {breakdown.perSideKg} kg
            </span>
          </div>

          <div className="flex items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => adjustWeight(-5)}
              className="btn alt !px-3 !min-h-[44px]"
            >
              −5
            </button>
            <button
              type="button"
              onClick={() => adjustWeight(-2.5)}
              aria-label="Decrease by 2.5kg"
              className="stepper-btn"
            >
              <Minus className="w-5 h-5" />
            </button>

            <input
              type="text"
              inputMode="decimal"
              value={rawInput}
              onChange={(e) => {
                const normalized = e.target.value.replace(',', '.');
                setRawInput(e.target.value);
                const parsed = parseFloat(normalized);
                if (!Number.isNaN(parsed) && parsed >= 0) {
                  setTargetWeightKg(parsed);
                }
              }}
              aria-label="Target barbell weight in kg"
              className="nb-input !w-28 text-center font-marker text-2xl"
            />

            <button
              type="button"
              onClick={() => adjustWeight(2.5)}
              aria-label="Increase by 2.5kg"
              className="stepper-btn"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => adjustWeight(5)}
              className="btn alt !px-3 !min-h-[44px]"
            >
              +5
            </button>
          </div>

          {/* Quick Milestone Presets */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[
              { kg: 40, label: '40kg' },
              { kg: 60, label: '60kg (1 Plt)' },
              { kg: 80, label: '80kg' },
              { kg: 100, label: '100kg (2 Plt)' },
              { kg: 120, label: '120kg' },
              { kg: 140, label: '140kg (3 Plt)' },
              { kg: 180, label: '180kg (4 Plt)' },
            ].map((p) => (
              <button
                key={p.kg}
                type="button"
                onClick={() => {
                  playMechanicalClick(soundEnabled);
                  setTargetWeightKg(p.kg);
                  setRawInput(String(p.kg));
                }}
                className={`pill cursor-pointer min-h-[36px] px-3 ${
                  targetWeightKg === p.kg ? 'gold' : ''
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Cartoon Barbell Sleeve Graphic */}
        <div className="card space-y-3 bg-[#ece2c6]">
          <div className="flex items-center justify-between text-sm font-bold">
            <span className="uppercase text-[#5d5446]">
              Right Sleeve Visualization (Inside → Out)
            </span>
            <span className="font-marker text-lg text-[#1d1a16]">
              Total Loaded: {breakdown.exactLoadedTotalKg} kg
            </span>
          </div>

          <div className="relative h-36 flex items-center justify-start overflow-x-auto px-3 py-2 bg-[#fbf5e4] border-[3px] border-[#1d1a16] rounded-[10px]">
            {/* Barbell Shaft */}
            <div className="h-4 w-12 bg-[#8c857B] border-[2.5px] border-[#1d1a16] shrink-0 flex items-center justify-center text-[11px] font-bold text-white">
              {barWeightKg}kg
            </div>
            {/* Inner Sleeve Shoulder */}
            <div className="h-10 w-3.5 bg-[#5d5446] border-y-[2.5px] border-r-[2.5px] border-[#1d1a16] shrink-0" />

            {/* Loaded IPF Plates */}
            <div className="flex items-center gap-[3px] shrink-0 px-1">
              {breakdown.flatPlates.length === 0 ? (
                <span className="px-4 text-sm font-bold text-[#5d5446]">
                  Empty Bar ({barWeightKg}kg) — Add weight above!
                </span>
              ) : (
                breakdown.flatPlates.map((plate, idx) => (
                  <div
                    key={`${plate.weightKg}-${idx}`}
                    style={{
                      height: `${plate.heightPx}px`,
                      width: `${plate.widthPx}px`,
                      backgroundColor: plate.fill,
                      color: plate.textColor,
                      boxShadow: '2px 2px 0 #1d1a16',
                    }}
                    className="border-[2.5px] border-[#1d1a16] rounded-[5px] flex items-center justify-center font-marker text-xs select-none shrink-0"
                  >
                    <span className="-rotate-90 whitespace-nowrap">
                      {plate.label}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Outer Sleeve & Collar */}
            {breakdown.flatPlates.length > 0 && (
              <div
                className="h-9 w-3.5 bg-[#d9412b] border-[2.5px] border-[#1d1a16] rounded-[3px] shrink-0 ml-0.5"
                title="2.5kg Lock Collar"
              />
            )}
            <div className="h-5 flex-1 min-w-[28px] bg-[#b8b2a6] border-y-[2.5px] border-r-[2.5px] border-[#1d1a16] rounded-r-[4px]" />
          </div>

          {/* Per-Side Plate Breakdown Pills */}
          <div className="space-y-1.5">
            <div className="text-sm font-bold text-[#5d5446]">
              Load on EACH side of the {barWeightKg}kg bar:
            </div>
            {breakdown.platesPerSide.length === 0 ? (
              <p className="text-base font-bold">No plates required (Empty Bar).</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {breakdown.platesPerSide.map(({ spec, count }) => (
                  <span
                    key={spec.weightKg}
                    style={{
                      backgroundColor: spec.fill,
                      color: spec.textColor,
                    }}
                    className="pill text-base px-3 py-1 border-[2.5px] border-[#1d1a16]"
                  >
                    <Disc className="w-4 h-4" />
                    {count} × {spec.weightKg}kg
                  </span>
                ))}
              </div>
            )}
            {breakdown.unmatchedRemainderKg > 0 && (
              <div className="note mt-2 text-sm font-bold">
                Note: {breakdown.unmatchedRemainderKg}kg remainder cannot be formed with standard 1.25kg mini-plates. Rounded to {breakdown.exactLoadedTotalKg}kg.
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center gap-2.5 pt-1">
          {onApplyWeight && (
            <button
              type="button"
              onClick={() => {
                playMechanicalClick(soundEnabled);
                onApplyWeight(breakdown.exactLoadedTotalKg);
                onClose();
              }}
              className="btn big flex-1"
            >
              USE {breakdown.exactLoadedTotalKg} KG IN SET
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              playMechanicalClick(soundEnabled);
              onClose();
            }}
            className="btn alt flex-1"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
