'use client';

import React, { useEffect, useState } from 'react';
import { Button, Sheet } from '@/components/ui';
import type { LoggerRepQuality } from './trackingFormat';
import { getQualityBadgeColor } from './trackingFormat';

export interface SetQualityPopoverProps {
  open: boolean;
  onClose: () => void;
  setNumber: number;
  setLabel?: string;
  reps: number | null;
  qualityPct: number | null;
  repQualities: LoggerRepQuality[];
  onApply: (
    qualityPct: number | null,
    repQualities: LoggerRepQuality[],
  ) => void;
}

const PRESETS = [
  { value: 100, label: '100% Clean' },
  { value: 85, label: '85% Minor' },
  { value: 70, label: '70% Assisted' },
  { value: 50, label: '50% Partial' },
];

const CYCLE_VALUES = [100, 85, 70, 50];

function nextCycleValue(current: number): number {
  const idx = CYCLE_VALUES.indexOf(current);
  if (idx === -1) return 100;
  return CYCLE_VALUES[(idx + 1) % CYCLE_VALUES.length];
}

export default function SetQualityPopover({
  open,
  onClose,
  setNumber,
  setLabel,
  reps,
  qualityPct,
  repQualities,
  onApply,
}: SetQualityPopoverProps) {
  const [draftPct, setDraftPct] = useState<number>(qualityPct ?? 100);
  const [perRepMode, setPerRepMode] = useState<boolean>(
    repQualities.length > 0,
  );
  const [repMap, setRepMap] = useState<Record<number, number>>({});

  const repCount =
    reps !== null && Number.isFinite(reps) && reps > 0
      ? Math.min(30, Math.round(reps))
      : 0;

  useEffect(() => {
    if (!open) return;
    setDraftPct(qualityPct ?? 100);
    const hasPerRep = repQualities.length > 0 && repCount > 0;
    setPerRepMode(hasPerRep);
    const map: Record<number, number> = {};
    for (let r = 1; r <= repCount; r += 1) {
      const found = repQualities.find((rq) => rq.repIndex === r);
      map[r] = found ? found.qualityPct : qualityPct ?? 100;
    }
    setRepMap(map);
  }, [open, qualityPct, repQualities, repCount]);

  const computePerRepAvg = (map: Record<number, number>): number => {
    if (repCount <= 0) return draftPct;
    let total = 0;
    for (let r = 1; r <= repCount; r += 1) {
      total += map[r] ?? 100;
    }
    return Math.round(total / repCount);
  };

  const handleTogglePerRep = () => {
    if (!perRepMode) {
      const nextMap: Record<number, number> = {};
      for (let r = 1; r <= repCount; r += 1) {
        nextMap[r] = draftPct;
      }
      setRepMap(nextMap);
      setPerRepMode(true);
    } else {
      setDraftPct(computePerRepAvg(repMap));
      setPerRepMode(false);
    }
  };

  const handleCycleRep = (repIdx: number) => {
    const current = repMap[repIdx] ?? 100;
    const next = nextCycleValue(current);
    const nextMap = { ...repMap, [repIdx]: next };
    setRepMap(nextMap);
    setDraftPct(computePerRepAvg(nextMap));
  };

  const handleSave = () => {
    if (perRepMode && repCount > 0) {
      const avg = computePerRepAvg(repMap);
      const overrides: LoggerRepQuality[] = [];
      for (let r = 1; r <= repCount; r += 1) {
        const val = repMap[r] ?? 100;
        if (val !== 100) {
          overrides.push({ repIndex: r, qualityPct: val });
        }
      }
      onApply(avg === 100 && overrides.length === 0 ? null : avg, overrides);
    } else {
      onApply(draftPct === 100 ? null : draftPct, []);
    }
    onClose();
  };

  const displayedPct = perRepMode && repCount > 0 ? computePerRepAvg(repMap) : draftPct;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={setLabel ? `${setLabel} Quality` : `Set #${setNumber} Quality`}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span
            className={`pill text-lg px-3.5 py-1 ${getQualityBadgeColor(displayedPct)}`}
          >
            {displayedPct}%
          </span>

          {repCount > 0 && (
            <button
              type="button"
              onClick={handleTogglePerRep}
              className={`btn alt !min-h-[44px] !px-3 text-base ${
                perRepMode ? '!bg-[var(--gold-bg)]' : ''
              }`}
            >
              {perRepMode ? 'Per-rep: ON' : 'Per-rep'}
            </button>
          )}
        </div>

        {!perRepMode ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setDraftPct(p.value)}
                  className={`btn alt !min-h-[44px] text-base ${
                    draftPct === p.value
                      ? '!bg-[var(--gold)] !text-[var(--btn-gold-fg)]'
                      : ''
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDraftPct((v) => Math.max(0, v - 5))}
                className="btn alt !min-h-[44px] !px-3"
              >
                −5
              </button>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={draftPct}
                onChange={(e) => setDraftPct(Number(e.target.value))}
                aria-label="Execution quality percentage"
                className="flex-1 h-10 accent-[var(--ink)]"
              />
              <button
                type="button"
                onClick={() => setDraftPct((v) => Math.min(100, v + 5))}
                className="btn alt !min-h-[44px] !px-3"
              >
                +5
              </button>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: repCount }, (_, i) => i + 1).map((r) => {
              const val = repMap[r] ?? 100;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => handleCycleRep(r)}
                  className={`min-h-[44px] rounded-[8px] border-[2.5px] border-[var(--line)] px-2 py-1 font-bold text-sm shadow-[2px_2px_0_var(--shadow-color)] ${getQualityBadgeColor(
                    val,
                  )}`}
                >
                  #{r} · {val}%
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="alt"
            className="flex-1"
            onClick={() => {
              onApply(null, []);
              onClose();
            }}
          >
            Reset 100%
          </Button>
          <Button variant="primary" className="flex-1" onClick={handleSave}>
            Apply
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
