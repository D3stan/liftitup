'use client';

import React, { useState, useMemo } from 'react';
import type { MuscleVolumeLandmark, MuscleGroup } from '@/types/domain';
import { Flame, CheckCircle2, AlertTriangle, TrendingUp, Info } from 'lucide-react';

interface VolumeLandmarksCardProps {
  landmarks: MuscleVolumeLandmark[];
}

type CategoryFilter = 'all' | 'upper_push' | 'upper_pull' | 'lower_core' | 'needs_volume';

const PUSH_MUSCLES: MuscleGroup[] = ['chest', 'front_delts', 'side_delts', 'triceps'];
const PULL_MUSCLES: MuscleGroup[] = ['lats', 'upper_back', 'rear_delts', 'biceps'];
const LOWER_CORE_MUSCLES: MuscleGroup[] = ['quads', 'hamstrings', 'glutes', 'calves', 'abs'];

const ZONE_META: Record<
  MuscleVolumeLandmark['zone'],
  { label: string; pillClass: string; fillStyle: string; description: string }
> = {
  below_mev: {
    label: 'BELOW MEV',
    pillClass: 'pill',
    fillStyle: 'repeating-linear-gradient(-45deg, #a39e93 0 8px, #857f74 8px 16px)',
    description: 'Maintenance / Sub-threshold volume',
  },
  mev_to_mav: {
    label: 'MEV → MAV',
    pillClass: 'pill gold',
    fillStyle: 'repeating-linear-gradient(-45deg, var(--gold) 0 8px, #d99b16 8px 16px)',
    description: 'Growing — add 2–3 sets to hit MAV sweet spot',
  },
  mav_sweet_spot: {
    label: 'MAV OPTIMAL ✔',
    pillClass: 'pill green',
    fillStyle: 'repeating-linear-gradient(-45deg, var(--green) 0 8px, #22602c 8px 16px)',
    description: 'Peak hypertrophy stimulus-to-fatigue ratio',
  },
  mrv_overreaching: {
    label: 'MRV DANGER ⚠',
    pillClass: 'pill red',
    fillStyle: 'repeating-linear-gradient(-45deg, var(--red) 0 8px, #b5321f 8px 16px)',
    description: 'Approaching systemic recovery ceiling',
  },
};

export default function VolumeLandmarksCard({ landmarks }: VolumeLandmarksCardProps) {
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup | null>(null);

  const filteredLandmarks = useMemo(() => {
    return landmarks.filter((item) => {
      if (filter === 'upper_push') return PUSH_MUSCLES.includes(item.muscle);
      if (filter === 'upper_pull') return PULL_MUSCLES.includes(item.muscle);
      if (filter === 'lower_core') return LOWER_CORE_MUSCLES.includes(item.muscle);
      if (filter === 'needs_volume') {
        return item.zone === 'below_mev' || item.zone === 'mev_to_mav';
      }
      return true;
    });
  }, [landmarks, filter]);

  const summaryCounts = useMemo(() => {
    const inMav = landmarks.filter((l) => l.zone === 'mav_sweet_spot').length;
    const inMev = landmarks.filter((l) => l.zone === 'mev_to_mav').length;
    const belowMev = landmarks.filter((l) => l.zone === 'below_mev').length;
    const overMrv = landmarks.filter((l) => l.zone === 'mrv_overreaching').length;
    const totalFractionalSets = landmarks.reduce((acc, l) => acc + l.weeklySets, 0);
    return { inMav, inMev, belowMev, overMrv, totalFractionalSets };
  }, [landmarks]);

  const coachNote = useMemo(() => {
    const belowOrLow = landmarks
      .filter((l) => l.weeklySets < l.mavMin)
      .sort((a, b) => (a.mavMin - a.weeklySets) - (b.mavMin - b.weeklySets));

    const overreaching = landmarks.filter((l) => l.zone === 'mrv_overreaching');

    if (overreaching.length > 0) {
      const names = overreaching.map((l) => l.label).join(', ');
      return `⚠️ Recovery Alert: ${names} reached MRV (${overreaching[0].weeklySets} sets). Hold volume steady or drop 2 sets next session to supercompensate.`;
    }

    if (belowOrLow.length === 0) {
      return `🔥 Elite Split Execution! All 13 muscle groups are inside the MAV Optimal Hypertrophy Zone (${summaryCounts.inMav}/13 in MAV). Focus on beating last week's reps or load!`;
    }

    const topTargets = belowOrLow.slice(0, 3);
    const callouts = topTargets
      .map((l) => {
        const needed = Math.max(0.5, Number((l.mavMin - l.weeklySets).toFixed(1)));
        return `${l.label} (+${needed} sets → ${l.mavMin} MAV)`;
      })
      .join(' • ');

    return `📌 Hypertrophy Coach Prescription: Add fractional or direct volume to enter the MAV sweet spot this week: ${callouts}.`;
  }, [landmarks, summaryCounts.inMav]);

  const activeDetail = useMemo(
    () => landmarks.find((l) => l.muscle === selectedMuscle) || null,
    [landmarks, selectedMuscle]
  );

  return (
    <section className="card space-y-4">
      {/* Header & Zone Summary Pills */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b-[2.5px] border-[#1d1a16] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl sm:text-2xl tracking-wide text-[#1d1a16]">
              VOLUME LANDMARKS & MASTERY
            </h2>
            <span className="pill gold text-xs">MEV / MAV / MRV</span>
          </div>
          <p className="text-sm text-[#5d5446] font-bold">
            7-Day Fractional Working Sets: <span className="text-[#1d1a16]">1.0× Primary</span> +{' '}
            <span className="text-[#1d1a16]">0.5× Secondary Synergists</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="pill green text-xs" title="Muscles in Maximum Adaptive Volume sweet spot">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#2e7d3a]" />
            {summaryCounts.inMav} in MAV
          </span>
          <span className="pill gold text-xs" title="Muscles between MEV and MAV">
            <TrendingUp className="w-3.5 h-3.5 text-[#1d1a16]" />
            {summaryCounts.inMev} Building
          </span>
          {summaryCounts.belowMev > 0 && (
            <span className="pill text-xs">
              {summaryCounts.belowMev} &lt; MEV
            </span>
          )}
          {summaryCounts.overMrv > 0 && (
            <span className="pill red text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-[#d9412b]" />
              {summaryCounts.overMrv} MRV
            </span>
          )}
        </div>
      </div>

      {/* Sticky Note Coach Recommendation */}
      <div className="note text-base font-bold text-[#1d1a16]">
        {coachNote}
      </div>

      {/* Category Filter Pills (44px+ hit targets) */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { id: 'all', label: `All Muscles (${landmarks.length})` },
            { id: 'needs_volume', label: `Needs MAV Boost (${summaryCounts.belowMev + summaryCounts.inMev})` },
            { id: 'upper_push', label: 'Push (Chest/Delts/Tri)' },
            { id: 'upper_pull', label: 'Pull (Lats/Back/Bi)' },
            { id: 'lower_core', label: 'Legs & Core' },
          ] as { id: CategoryFilter; label: string }[]
        ).map((tab) => {
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`btn !min-h-[44px] !px-3 !py-1.5 text-sm ${
                active ? '' : 'alt'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#ece2c6]/70 border-2 border-[#1d1a16] rounded-lg px-3 py-2 text-xs font-bold">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 inline-block rounded-sm border border-[#1d1a16] bg-[#ece2c6]" />
            MV (Maint.)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 inline-block rounded-sm border border-[#1d1a16] bg-[#fbedba]" />
            MEV (Min Effective)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 inline-block rounded-sm border border-[#1d1a16] bg-[#cde6c0]" />
            MAV (Optimal Growth Zone)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 inline-block rounded-sm border border-[#1d1a16] bg-[#f6cfc4]" />
            MRV (Overreaching)
          </span>
        </div>
        <span className="text-[#5d5446]">Tap any row for synergy breakdown</span>
      </div>

      {/* Muscle Volume Rows */}
      <div className="space-y-3">
        {filteredLandmarks.map((item) => {
          const maxScale = Math.max(item.mrv + 4, 24);
          const pctFill = Math.min(100, Math.round((item.weeklySets / maxScale) * 100));
          const mevLeft = Math.round((item.mev / maxScale) * 100);
          const mavMinLeft = Math.round((item.mavMin / maxScale) * 100);
          const mavMaxLeft = Math.round((item.mavMax / maxScale) * 100);
          const mrvLeft = Math.round((item.mrv / maxScale) * 100);
          const meta = ZONE_META[item.zone];
          const isSelected = selectedMuscle === item.muscle;

          return (
            <div
              key={item.muscle}
              role="button"
              tabIndex={0}
              onClick={() =>
                setSelectedMuscle(isSelected ? null : item.muscle)
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedMuscle(isSelected ? null : item.muscle);
                }
              }}
              className={`card-sm transition-transform cursor-pointer ${
                item.zone === 'mav_sweet_spot'
                  ? 'bg-[#cde6c0]/35'
                  : item.zone === 'mrv_overreaching'
                  ? 'bg-[#f6cfc4]/45'
                  : 'bg-[#fbf5e4]'
              } ${isSelected ? 'ring-2 ring-[#d9412b]' : ''}`}
            >
              {/* Row Top: Muscle Label + Mastery 4-Box Meter + Sets Count + Zone Pill */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2.5">
                  <span className="font-marker text-base sm:text-lg text-[#1d1a16]">
                    {item.label}
                  </span>

                  {/* 4-Box Discrete Muscle Mastery Meter */}
                  <div
                    className="inline-flex items-center gap-1.5 bg-[#fbf5e4] px-2 py-0.5 rounded border-[2px] border-[#1d1a16]"
                    title={`Mastery Rank: ${item.masteryTitle} (Level ${item.masteryLevel}/4 • ${item.masteryXp} XP)`}
                  >
                    <div className="level-meter">
                      {[1, 2, 3, 4].map((lvl) => (
                        <span
                          key={lvl}
                          className={`level-box ${
                            lvl <= item.masteryLevel
                              ? item.masteryLevel === 4
                                ? 'gold'
                                : 'on'
                              : ''
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-xs font-bold uppercase tracking-tight text-[#1d1a16]">
                      {item.masteryTitle}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-marker text-base text-[#1d1a16] tabular-nums">
                    {item.weeklySets.toFixed(1)}{' '}
                    <span className="font-sans text-xs font-bold text-[#5d5446]">
                      / {item.mavMin}–{item.mavMax} sets
                    </span>
                  </span>
                  <span className={`${meta.pillClass} !text-xs !py-0.5 !px-2`}>
                    {meta.label}
                  </span>
                </div>
              </div>

              {/* Landmark Track with Shaded MAV Sweet Spot & MRV Danger Zone */}
              <div className="relative h-6 bg-[#ece2c6] border-[2.5px] border-[#1d1a16] rounded-md overflow-hidden shadow-[2px_2px_0_#1d1a16]">
                {/* Shaded MAV Optimal Zone */}
                <div
                  className="absolute top-0 bottom-0 bg-[#cde6c0] border-x-2 border-dashed border-[#2e7d3a]"
                  style={{
                    left: `${mavMinLeft}%`,
                    width: `${Math.max(4, mavMaxLeft - mavMinLeft)}%`,
                  }}
                  title={`MAV Optimal Zone: ${item.mavMin}–${item.mavMax} sets/wk`}
                />

                {/* Shaded MRV Overreaching Zone */}
                <div
                  className="absolute top-0 bottom-0 right-0 bg-[#f6cfc4] border-l-2 border-dashed border-[#d9412b]"
                  style={{
                    left: `${mrvLeft}%`,
                  }}
                  title={`MRV Overreaching: ${item.mrv}+ sets/wk`}
                />

                {/* MEV Marker Line */}
                <div
                  className="absolute top-0 bottom-0 border-l-2 border-dotted border-[#1d1a16]/70 z-10"
                  style={{ left: `${mevLeft}%` }}
                  title={`MEV: ${item.mev} sets`}
                />

                {/* Candy-Striped Active Volume Fill */}
                <div
                  className="relative h-full z-10 border-r-[2.5px] border-[#1d1a16] transition-all duration-200"
                  style={{
                    width: `${ Math.max(3, pctFill) }%`,
                    background: meta.fillStyle,
                  }}
                />
              </div>

              {/* Landmark Micro-Labels under Bar */}
              <div className="mt-1 flex items-center justify-between text-xs font-bold text-[#5d5446]">
                <span>
                  Direct: <strong className="text-[#1d1a16]">{item.directSets}</strong> sets •
                  Synergist (0.5×): <strong className="text-[#1d1a16]">{item.indirectSets.toFixed(1)}</strong> sets
                </span>
                <span>
                  MV {item.mv} | MEV {item.mev} |{' '}
                  <strong className="text-[#2e7d3a]">
                    MAV {item.mavMin}–{item.mavMax}
                  </strong>{' '}
                  | <strong className="text-[#d9412b]">MRV {item.mrv}</strong>
                </span>
              </div>

              {/* Expandable Biomechanical Detail Drawer */}
              {isSelected && (
                <div className="mt-2.5 pt-2.5 border-t-2 border-dashed border-[#1d1a16] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm bg-[#fbf5e4] p-2.5 rounded border border-[#1d1a16]">
                  <div className="space-y-0.5">
                    <div className="font-bold text-[#1d1a16] flex items-center gap-1.5">
                      <Info className="w-4 h-4 text-[#2b5fa8]" />
                      <span>{meta.description}</span>
                    </div>
                    <p className="text-xs text-[#5d5446]">
                      Mastery Progress: <strong>{item.masteryXp} Hypertrophy XP</strong> logged on{' '}
                      {item.label} ({item.masteryTitle} Tier {item.masteryLevel}/4).
                    </p>
                  </div>
                  <div className="shrink-0">
                    {item.weeklySets < item.mavMin ? (
                      <span className="pill gold text-xs">
                        <Flame className="w-3.5 h-3.5 text-[#d9412b]" />
                        Add +{(item.mavMin - item.weeklySets).toFixed(1)} sets to reach MAV
                      </span>
                    ) : item.weeklySets <= item.mavMax ? (
                      <span className="pill green text-xs">
                        Optimal Stimulus Locked In
                      </span>
                    ) : (
                      <span className="pill red text-xs">
                        Deload or Cap Sets Next Session
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected Muscle Quick Callout Footer if any */}
      {activeDetail && (
        <div className="text-xs font-bold text-center text-[#5d5446]">
          Showing expanded hypertrophy landmarks for <strong>{activeDetail.label}</strong>. Tap again to collapse.
        </div>
      )}
    </section>
  );
}
