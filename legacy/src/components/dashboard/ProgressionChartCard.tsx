'use client';

import React, { useState, useMemo } from 'react';
import type {
  E1rmTrendPoint,
  ConsistencyDay,
  MovementSlot,
  ExerciseDefinition,
} from '@/types/domain';
import { TrendingUp, ArrowLeftRight, Calendar, Sparkles } from 'lucide-react';

interface ProgressionChartCardProps {
  trends: E1rmTrendPoint[];
  consistencyCalendar: ConsistencyDay[];
  exercises: ExerciseDefinition[];
  userBodyweightKg: number;
}

const SLOT_LABELS: Record<MovementSlot, string> = {
  vertical_pull: 'Vertical Pull (Pulley ↔ Chin-up)',
  horizontal_press: 'Horizontal Press (Bench / DB)',
  incline_press: 'Incline Press (Upper Chest)',
  horizontal_pull: 'Horizontal Row (Upper Back)',
  squat_pattern: 'Squat Pattern (Quad Dominant)',
  hinge_pattern: 'Hinge Pattern (RDL / Glutes)',
  vertical_press: 'Vertical Shoulder Press',
  lateral_delt: 'Lateral Delt Raises',
  rear_delt: 'Rear Delt Isolation',
  chest_isolation: 'Chest Fly / Isolation',
  knee_extension: 'Knee Extension (Quads)',
  knee_flexion: 'Knee Flexion (Hamstrings)',
  elbow_flexion: 'Elbow Flexion (Biceps)',
  elbow_extension: 'Elbow Extension (Triceps)',
  calf_core: 'Calves & Core',
};

export default function ProgressionChartCard({
  trends,
  consistencyCalendar,
  userBodyweightKg,
}: ProgressionChartCardProps) {
  // Group available movement slots from trend data, prioritizing vertical_pull first
  const availableSlots = useMemo(() => {
    const slotSet = new Set<MovementSlot>();
    for (const pt of trends) {
      slotSet.add(pt.movementSlot);
    }
    const list = Array.from(slotSet);
    list.sort((a, b) => {
      if (a === 'vertical_pull') return -1;
      if (b === 'vertical_pull') return 1;
      if (a === 'horizontal_press') return -1;
      if (b === 'horizontal_press') return 1;
      return a.localeCompare(b);
    });
    return list.length > 0
      ? list
      : (['vertical_pull', 'horizontal_press', 'squat_pattern'] as MovementSlot[]);
  }, [trends]);

  const [selectedSlot, setSelectedSlot] = useState<MovementSlot>('vertical_pull');
  const [selectedExerciseFilter, setSelectedExerciseFilter] = useState<string>('ALL_SLOT');
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);

  const slotPoints = useMemo(() => {
    const pts = trends
      .filter((t) => t.movementSlot === selectedSlot)
      .sort((a, b) => a.date.localeCompare(b.date));
    return pts;
  }, [trends, selectedSlot]);

  // Distinct exercises present in this movement slot's history
  const exercisesInSlot = useMemo(() => {
    const map = new Map<string, string>();
    for (const pt of slotPoints) {
      map.set(pt.exerciseId, pt.exerciseName);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [slotPoints]);

  const filteredPoints = useMemo(() => {
    if (selectedExerciseFilter === 'ALL_SLOT') return slotPoints;
    return slotPoints.filter((pt) => pt.exerciseId === selectedExerciseFilter);
  }, [slotPoints, selectedExerciseFilter]);

  const distinctExerciseIds = useMemo(
    () => Array.from(new Set(filteredPoints.map((p) => p.exerciseId))),
    [filteredPoints]
  );

  // Assign consistent ink/red/blue/green colors per exercise variation within the slot
  const exerciseColorMap = useMemo(() => {
    const palette = ['#d9412b', '#2b5fa8', '#2e7d3a', '#9b5de5'];
    const map = new Map<string, string>();
    exercisesInSlot.forEach((ex, idx) => {
      map.set(ex.id, palette[idx % palette.length]);
    });
    return map;
  }, [exercisesInSlot]);

  // SVG Chart Geometry
  const chartGeom = useMemo(() => {
    const width = 620;
    const height = 240;
    const padLeft = 48;
    const padRight = 24;
    const padTop = 26;
    const padBottom = 38;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    if (filteredPoints.length === 0) {
      return null;
    }

    const allValues: number[] = [];
    for (const p of filteredPoints) {
      allValues.push(p.slotCanonicalE1rmKg);
      allValues.push(p.exerciseE1rmKg);
      allValues.push(p.effectiveLoadKg);
    }

    const rawMin = Math.min(...allValues);
    const rawMax = Math.max(...allValues);
    const span = Math.max(10, rawMax - rawMin);
    const minVal = Math.max(0, Math.floor((rawMin - span * 0.15) / 5) * 5);
    const maxVal = Math.ceil((rawMax + span * 0.15) / 5) * 5;
    const valRange = Math.max(10, maxVal - minVal);

    const getX = (idx: number) => {
      if (filteredPoints.length === 1) return padLeft + plotW / 2;
      return padLeft + (idx / (filteredPoints.length - 1)) * plotW;
    };

    const getY = (val: number) => {
      const ratio = (val - minVal) / valRange;
      return padTop + plotH - ratio * plotH;
    };

    const canonicalCoords = filteredPoints.map((p, i) => ({
      x: getX(i),
      y: getY(p.slotCanonicalE1rmKg),
      point: p,
      index: i,
    }));

    const effectiveLoadCoords = filteredPoints.map((p, i) => ({
      x: getX(i),
      y: getY(p.effectiveLoadKg),
      point: p,
      index: i,
    }));

    const canonicalPolyline = canonicalCoords
      .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(' ');

    const effectiveLoadPolyline = effectiveLoadCoords
      .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(' ');

    // Next milestone target line (+2.5% above latest canonical e1RM)
    const latestCanonical =
      filteredPoints[filteredPoints.length - 1].slotCanonicalE1rmKg;
    const firstCanonical = filteredPoints[0].slotCanonicalE1rmKg;
    const totalDeltaKg = Number((latestCanonical - firstCanonical).toFixed(1));
    const totalDeltaPct =
      firstCanonical > 0
        ? Number(((totalDeltaKg / firstCanonical) * 100).toFixed(1))
        : 0;
    const targetMilestoneKg = Math.round((latestCanonical + 2.5) * 2) / 2;
    const targetY = getY(Math.min(maxVal, targetMilestoneKg));

    const yTicks = [
      minVal,
      Math.round(minVal + valRange * 0.33),
      Math.round(minVal + valRange * 0.66),
      maxVal,
    ];

    return {
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      canonicalCoords,
      effectiveLoadCoords,
      canonicalPolyline,
      effectiveLoadPolyline,
      latestCanonical,
      firstCanonical,
      totalDeltaKg,
      totalDeltaPct,
      targetMilestoneKg,
      targetY,
      yTicks,
      getY,
    };
  }, [filteredPoints]);

  const inspectedPoint = useMemo(() => {
    if (filteredPoints.length === 0) return null;
    if (activePointIndex !== null && filteredPoints[activePointIndex]) {
      return filteredPoints[activePointIndex];
    }
    return filteredPoints[filteredPoints.length - 1];
  }, [filteredPoints, activePointIndex]);

  // Consistency heatmap stats
  const consistencyStats = useMemo(() => {
    const trainedDays = consistencyCalendar.filter((d) => d.trained).length;
    const totalPrs = consistencyCalendar.reduce(
      (sum, d) => sum + (d.prsCount || 0),
      0
    );
    return { trainedDays, totalPrs };
  }, [consistencyCalendar]);

  return (
    <section className="card space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b-[2.5px] border-[#1d1a16] pb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl sm:text-2xl tracking-wide text-[#1d1a16]">
              e1RM & VARIATION CONTINUITY CURVES
            </h2>
            <span className="pill gold text-xs">
              <ArrowLeftRight className="w-3.5 h-3.5" />
              SLOT EQUIVALENCE
            </span>
          </div>
          <p className="text-sm text-[#5d5446] font-bold">
            Canonical Movement Slot e1RM keeps your progressive overload curve unbroken when swapping variations
          </p>
        </div>

        {chartGeom && (
          <div className="kpi ok !py-1.5 !px-3 flex items-center gap-2 shrink-0">
            <div>
              <div className="text-[11px] font-bold uppercase text-[#5d5446]">
                8-Week Slot e1RM
              </div>
              <div className="font-marker text-base sm:text-lg text-[#1d1a16]">
                <span className="text-[#5d5446] line-through text-sm mr-1">
                  {chartGeom.firstCanonical.toFixed(1)}kg
                </span>
                → {chartGeom.latestCanonical.toFixed(1)}kg{' '}
                <span className="text-[#2e7d3a] text-sm">
                  ▲ +{chartGeom.totalDeltaKg}kg ({chartGeom.totalDeltaPct}%)
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Movement Slot Selector Pills */}
      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-[#5d5446]">
          1. Select Biomechanical Movement Slot
        </div>
        <div className="flex flex-wrap gap-1.5">
          {availableSlots.map((slot) => {
            const active = selectedSlot === slot;
            return (
              <button
                key={slot}
                type="button"
                onClick={() => {
                  setSelectedSlot(slot);
                  setSelectedExerciseFilter('ALL_SLOT');
                  setActivePointIndex(null);
                }}
                className={`btn !min-h-[44px] !px-3 !py-1 text-sm ${
                  active ? '' : 'alt'
                }`}
              >
                {SLOT_LABELS[slot] || slot.replace('_', ' ')}
              </button>
            );
          })}
        </div>
      </div>

      {/* Exercise Variation Filter inside Selected Slot */}
      {exercisesInSlot.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#ece2c6]/75 border-2 border-[#1d1a16] rounded-lg p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold uppercase text-[#5d5446] mr-1">
              Slot Variations:
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedExerciseFilter('ALL_SLOT');
                setActivePointIndex(null);
              }}
              className={`pill cursor-pointer !min-h-[36px] ${
                selectedExerciseFilter === 'ALL_SLOT' ? 'gold' : ''
              }`}
            >
              🔗 Unified Slot Curve ({exercisesInSlot.length} Variations)
            </button>
            {exercisesInSlot.map((ex) => {
              const color = exerciseColorMap.get(ex.id) || '#d9412b';
              const active = selectedExerciseFilter === ex.id;
              return (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => {
                    setSelectedExerciseFilter(ex.id);
                    setActivePointIndex(null);
                  }}
                  className={`pill cursor-pointer !min-h-[36px] ${
                    active ? 'gold' : ''
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full border border-[#1d1a16] inline-block"
                    style={{ backgroundColor: color }}
                  />
                  {ex.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Sticky Note Highlighting Pulley <-> Weighted Chin-up Equivalence when Multiple Variations Exist */}
      {distinctExerciseIds.length > 1 && (
        <div className="note text-sm sm:text-base font-bold text-[#1d1a16]">
          🔄 <strong>Biomechanical Equivalence Active:</strong> This curve unifies{' '}
          {exercisesInSlot.map((e) => e.name).join(' ↔ ')} onto a single{' '}
          <strong>Slot Canonical e1RM</strong> axis (factoring in your{' '}
          <strong>{userBodyweightKg}kg</strong> bodyweight + belt load on chin-ups/dips and pulley leverage ratios).
        </div>
      )}

      {/* Hand-Drawn SVG Polyline Chart */}
      {chartGeom ? (
        <div className="card-sm bg-[#fbf5e4] p-3 space-y-3">
          {/* Chart Legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-5 h-1 bg-[#1d1a16] inline-block rounded" />
                Canonical Slot e1RM (kg)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-5 h-1 bg-[#2b5fa8] inline-block rounded opacity-80" />
                Effective Working Load (kg)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-5 border-b-2 border-dashed border-[#2e7d3a] inline-block" />
                Next Boss Target ({chartGeom.targetMilestoneKg}kg)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {exercisesInSlot.map((ex) => (
                <span key={ex.id} className="inline-flex items-center gap-1">
                  <span
                    className="w-3 h-3 rounded-full border-[2px] border-[#1d1a16] inline-block"
                    style={{
                      backgroundColor: exerciseColorMap.get(ex.id) || '#d9412b',
                    }}
                  />
                  <span>{ex.name}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Responsive Hand-Drawn SVG */}
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${chartGeom.width} ${chartGeom.height}`}
              className="w-full h-auto min-w-[320px] select-none"
              role="img"
              aria-label="Progressive overload e1RM polyline chart"
            >
              {/* Horizontal Grid Lines & Y-Axis Labels */}
              {chartGeom.yTicks.map((tickVal, i) => {
                const y = chartGeom.getY(tickVal);
                return (
                  <g key={i}>
                    <line
                      x1={chartGeom.padLeft}
                      y1={y}
                      x2={chartGeom.width - chartGeom.padRight}
                      y2={y}
                      stroke="#1d1a16"
                      strokeOpacity="0.16"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={chartGeom.padLeft - 8}
                      y={y + 4}
                      textAnchor="end"
                      fontSize="12"
                      fontWeight="bold"
                      fill="#5d5446"
                    >
                      {tickVal}kg
                    </text>
                  </g>
                );
              })}

              {/* Dashed Next Target Threshold Line */}
              <line
                x1={chartGeom.padLeft}
                y1={chartGeom.targetY}
                x2={chartGeom.width - chartGeom.padRight}
                y2={chartGeom.targetY}
                stroke="#2e7d3a"
                strokeWidth="2.5"
                strokeDasharray="6 4"
              />
              <text
                x={chartGeom.width - chartGeom.padRight - 4}
                y={Math.max(14, chartGeom.targetY - 6)}
                textAnchor="end"
                fontSize="11"
                fontWeight="bold"
                fill="#2e7d3a"
              >
                TARGET {chartGeom.targetMilestoneKg}kg
              </text>

              {/* Secondary Line: Effective Working Load (Blue) */}
              <polyline
                fill="none"
                stroke="#2b5fa8"
                strokeWidth="3.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeOpacity="0.75"
                points={chartGeom.effectiveLoadPolyline}
              />

              {/* Primary Line: Unbroken Slot Canonical e1RM Curve (Bold Ink) */}
              <polyline
                fill="none"
                stroke="#1d1a16"
                strokeWidth="4.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={chartGeom.canonicalPolyline}
              />

              {/* Effective Load Markers */}
              {chartGeom.effectiveLoadCoords.map((c) => (
                <circle
                  key={`load-${c.index}`}
                  cx={c.x}
                  cy={c.y}
                  r="4.5"
                  fill="#d4e3f7"
                  stroke="#1d1a16"
                  strokeWidth="2"
                  className="cursor-pointer"
                  onClick={() => setActivePointIndex(c.index)}
                />
              ))}

              {/* Canonical e1RM Interactive Markers (Color-Coded by Exercise Variation!) */}
              {chartGeom.canonicalCoords.map((c) => {
                const isSelected =
                  (activePointIndex === null &&
                    c.index === chartGeom.canonicalCoords.length - 1) ||
                  activePointIndex === c.index;
                const dotColor =
                  exerciseColorMap.get(c.point.exerciseId) || '#d9412b';

                return (
                  <g
                    key={`e1rm-${c.index}`}
                    className="cursor-pointer"
                    onClick={() => setActivePointIndex(c.index)}
                  >
                    <title>
                      {c.point.date}: {c.point.exerciseName} —{' '}
                      {c.point.weightKg}kg × {c.point.reps} @ RIR {c.point.rir}{' '}
                      (Canonical e1RM: {c.point.slotCanonicalE1rmKg}kg)
                    </title>
                    {isSelected && (
                      <circle
                        cx={c.x}
                        cy={c.y}
                        r="11"
                        fill="#f2b632"
                        stroke="#1d1a16"
                        strokeWidth="2"
                      />
                    )}
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r={isSelected ? '7.5' : '6.5'}
                      fill={dotColor}
                      stroke="#1d1a16"
                      strokeWidth="2.8"
                    />
                    {/* X-Axis Date Label */}
                    <text
                      x={c.x}
                      y={chartGeom.height - 10}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="bold"
                      fill={isSelected ? '#1d1a16' : '#5d5446'}
                    >
                      {c.point.date.slice(5)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Inspected Session Point Detail Banner */}
          {inspectedPoint && (
            <div className="bg-[#ece2c6] border-2 border-[#1d1a16] rounded-lg p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="pill gold !text-xs !py-0.5 !px-2">
                    {inspectedPoint.date}
                  </span>
                  <span className="font-marker text-base text-[#1d1a16]">
                    {inspectedPoint.exerciseName}
                  </span>
                  {inspectedPoint.isSwappedVariation && (
                    <span className="pill blue !text-xs !py-0.5 !px-2">
                      🔄 Variation Swap
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm font-bold text-[#5d5446]">
                  Logged Top Set:{' '}
                  <strong className="text-[#1d1a16]">
                    {inspectedPoint.weightKg}kg external
                  </strong>{' '}
                  {inspectedPoint.effectiveLoadKg !== inspectedPoint.weightKg && (
                    <span>
                      ({inspectedPoint.effectiveLoadKg.toFixed(1)}kg total effective load){' '}
                    </span>
                  )}
                  × <strong className="text-[#1d1a16]">{inspectedPoint.reps} reps</strong> @ RIR{' '}
                  {inspectedPoint.rir}
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0 bg-[#fbf5e4] px-3 py-1.5 rounded border-2 border-[#1d1a16] shadow-[2px_2px_0_#1d1a16]">
                <div>
                  <div className="text-[10px] font-bold uppercase text-[#5d5446]">
                    Exercise e1RM
                  </div>
                  <div className="font-marker text-base text-[#1d1a16]">
                    {inspectedPoint.exerciseE1rmKg.toFixed(1)} kg
                  </div>
                </div>
                <div className="border-l-2 border-[#1d1a16]/25 pl-3">
                  <div className="text-[10px] font-bold uppercase text-[#2e7d3a]">
                    Slot Canonical e1RM
                  </div>
                  <div className="font-marker text-base text-[#2e7d3a]">
                    {inspectedPoint.slotCanonicalE1rmKg.toFixed(1)} kg
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="card-sm text-center py-6 font-bold text-[#5d5446]">
          No progression sets logged for this movement slot yet. Complete a session to start your curve!
        </div>
      )}

      {/* 28-Day Consistency Heatmap Calendar Strip */}
      <div className="card-sm bg-[#fbf5e4] space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#d9412b]" />
            <span className="font-marker text-base text-[#1d1a16]">
              28-DAY CONSISTENCY HEATMAP
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold">
            <span className="pill green !text-xs !py-0.5 !px-2">
              ✔ {consistencyStats.trainedDays} Workouts Logged
            </span>
            {consistencyStats.totalPrs > 0 && (
              <span className="pill gold !text-xs !py-0.5 !px-2">
                <Sparkles className="w-3 h-3 text-[#d9412b]" />
                {consistencyStats.totalPrs} PR Days
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-7 sm:grid-cols-14 gap-1.5">
          {consistencyCalendar.slice(-28).map((day) => {
            const hasPr = (day.prsCount || 0) > 0;
            const bgClass = day.trained
              ? hasPr
                ? 'bg-[#f2b632]'
                : 'bg-[#cde6c0]'
              : day.isScheduledRest
              ? 'bg-[#ece2c6]/60'
              : 'bg-[#fbf5e4]';

            return (
              <div
                key={day.date}
                title={`${day.date}: ${
                  day.trained
                    ? `${day.routineLabel || 'Trained'} (${day.volumeKg || 0}kg${
                        hasPr ? `, ${day.prsCount} PR!` : ''
                      })`
                    : day.isScheduledRest
                    ? 'Scheduled Rest Day'
                    : 'Rest / Unlogged'
                }`}
                className={`h-10 rounded-md border-2 border-[#1d1a16] flex flex-col items-center justify-center text-[11px] font-bold shadow-[1.5px_1.5px_0_#1d1a16] ${bgClass}`}
              >
                <span className="text-[10px] text-[#5d5446] leading-none">
                  {day.date.slice(8)}
                </span>
                <span className="font-marker text-xs leading-tight text-[#1d1a16]">
                  {day.trained ? (hasPr ? '★' : '✔') : '·'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
