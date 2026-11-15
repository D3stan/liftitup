'use client';

import React, { useState, useMemo } from 'react';
import type { MuscleRecoveryStatus, MuscleGroup } from '@/types/domain';
import { BatteryCharging, Clock, Zap, ShieldCheck, Flame } from 'lucide-react';

interface MuscleRecoveryMapProps {
  recoveryList: MuscleRecoveryStatus[];
}

function getMuscleFill(pct: number, status: MuscleRecoveryStatus['status']): string {
  if (pct >= 85 || status === 'fresh') return '#cde6c0'; // --green-bg Fresh
  if (pct >= 45 || status === 'recovering') return '#fff27a'; // --note Recovering
  return '#f6cfc4'; // --red-bg Fatigued
}

function getStatusBadge(pct: number, status: MuscleRecoveryStatus['status']) {
  if (pct >= 85 || status === 'fresh') {
    return { label: 'FRESH • PRIME TO TRAIN', pill: 'pill green', icon: '🟢' };
  }
  if (pct >= 45 || status === 'recovering') {
    return { label: 'RECOVERING (SUPERCOMPENSATING)', pill: 'pill gold', icon: '🟡' };
  }
  return { label: 'FATIGUED • REST NEEDED', pill: 'pill red', icon: '🔴' };
}

export default function MuscleRecoveryMap({ recoveryList }: MuscleRecoveryMapProps) {
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup>('lats');

  const recoveryByMuscle = useMemo(() => {
    const map = new Map<MuscleGroup, MuscleRecoveryStatus>();
    for (const item of recoveryList) {
      map.set(item.muscle, item);
    }
    return map;
  }, [recoveryList]);

  const getMuscleData = (muscle: MuscleGroup): MuscleRecoveryStatus => {
    return (
      recoveryByMuscle.get(muscle) || {
        muscle,
        label: muscle.replace('_', ' ').toUpperCase(),
        recoveryPct: 100,
        status: 'fresh',
        hoursSinceLastTrained: null,
        lastSetsLogged: 0,
        readyInHours: 0,
      }
    );
  };

  const activeMuscle = getMuscleData(selectedMuscle);
  const activeBadge = getStatusBadge(activeMuscle.recoveryPct, activeMuscle.status);

  const counts = useMemo(() => {
    const fresh = recoveryList.filter((m) => m.recoveryPct >= 85).length;
    const recovering = recoveryList.filter(
      (m) => m.recoveryPct >= 45 && m.recoveryPct < 85
    ).length;
    const fatigued = recoveryList.filter((m) => m.recoveryPct < 45).length;
    return { fresh, recovering, fatigued };
  }, [recoveryList]);

  const fillFor = (m: MuscleGroup) => {
    const d = getMuscleData(m);
    return getMuscleFill(d.recoveryPct, d.status);
  };

  const strokeWidthFor = (m: MuscleGroup) => (selectedMuscle === m ? 4 : 2.6);
  const opacityFor = (m: MuscleGroup) => (selectedMuscle === m ? 1 : 0.92);

  return (
    <section className="card space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b-[2.5px] border-[#1d1a16] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl sm:text-2xl tracking-wide text-[#1d1a16]">
              72-HOUR MUSCLE RECOVERY MAP
            </h2>
            <span className="pill blue text-xs">SRA BIOMECHANICS</span>
          </div>
          <p className="text-sm text-[#5d5446] font-bold">
            Tap any muscle on the cartoon body map or grid to inspect Stimulus-Recovery-Adaptation state
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="pill green text-xs">🟢 {counts.fresh} Fresh (85–100%)</span>
          <span className="pill gold text-xs">🟡 {counts.recovering} Recovering (45–84%)</span>
          <span className="pill red text-xs">🔴 {counts.fatigued} Fatigued (&lt;45%)</span>
        </div>
      </div>

      {/* Selected Muscle Telemetry Spotlight Card */}
      <div
        className="card-sm border-[3px] border-[#1d1a16] transition-colors"
        style={{
          backgroundColor: getMuscleFill(activeMuscle.recoveryPct, activeMuscle.status),
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl" aria-hidden="true">
              {activeBadge.icon}
            </span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-marker text-xl sm:text-2xl text-[#1d1a16]">
                  {activeMuscle.label}
                </span>
                <span className="bg-[#fbf5e4] px-2.5 py-0.5 rounded-full border-2 border-[#1d1a16] font-marker text-base text-[#1d1a16]">
                  {activeMuscle.recoveryPct}% RECOVERED
                </span>
              </div>
              <p className="text-xs sm:text-sm font-bold text-[#1d1a16]/85">
                {activeBadge.label}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 bg-[#fbf5e4] p-2 rounded-lg border-2 border-[#1d1a16] shadow-[2px_2px_0_#1d1a16]">
            <div className="text-center px-1">
              <div className="text-[11px] font-bold text-[#5d5446] uppercase flex items-center justify-center gap-1">
                <Clock className="w-3 h-3 text-[#1d1a16]" /> Last Hit
              </div>
              <div className="font-marker text-sm sm:text-base text-[#1d1a16]">
                {activeMuscle.hoursSinceLastTrained !== null
                  ? `${activeMuscle.hoursSinceLastTrained}h ago`
                  : '72h+ ago'}
              </div>
            </div>
            <div className="text-center px-1 border-x border-[#1d1a16]/30">
              <div className="text-[11px] font-bold text-[#5d5446] uppercase flex items-center justify-center gap-1">
                <Flame className="w-3 h-3 text-[#d9412b]" /> 72h Volume
              </div>
              <div className="font-marker text-sm sm:text-base text-[#1d1a16]">
                {activeMuscle.lastSetsLogged.toFixed(1)} sets
              </div>
            </div>
            <div className="text-center px-1">
              <div className="text-[11px] font-bold text-[#5d5446] uppercase flex items-center justify-center gap-1">
                <BatteryCharging className="w-3 h-3 text-[#2e7d3a]" /> 100% Fresh
              </div>
              <div className="font-marker text-sm sm:text-base text-[#1d1a16]">
                {activeMuscle.readyInHours <= 0
                  ? 'READY NOW'
                  : `in ~${activeMuscle.readyInHours}h`}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dual Anterior (Front) & Posterior (Back) Cartoon Anatomy SVGs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* ANTERIOR (FRONT) */}
        <div className="card-sm bg-[#fbf5e4] flex flex-col items-center p-3">
          <div className="w-full flex items-center justify-between mb-1">
            <span className="font-marker text-base text-[#1d1a16]">
              ANTERIOR (FRONT)
            </span>
            <span className="text-xs font-bold text-[#5d5446]">
              Tap muscle region
            </span>
          </div>

          <svg
            viewBox="0 0 220 340"
            className="w-full max-w-[230px] h-auto select-none"
            role="img"
            aria-label="Anterior muscle recovery map"
          >
            {/* Head & Neck Outline (Non-interactive) */}
            <circle
              cx="110"
              cy="30"
              r="18"
              fill="#ece2c6"
              stroke="#1d1a16"
              strokeWidth="2.8"
            />
            {/* Cartoon Headband */}
            <path
              d="M 93 24 Q 110 28 127 24"
              fill="none"
              stroke="#d9412b"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <rect
              x="102"
              y="47"
              width="16"
              height="12"
              rx="3"
              fill="#ece2c6"
              stroke="#1d1a16"
              strokeWidth="2.5"
            />

            {/* SIDE DELTS (Outer Caps) */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('side_delts')}
            >
              <title>Side Delts ({getMuscleData('side_delts').recoveryPct}%)</title>
              <path
                d="M 66 62 C 52 66 48 82 54 95 C 60 95 66 86 68 74 Z"
                fill={fillFor('side_delts')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('side_delts')}
                opacity={opacityFor('side_delts')}
              />
              <path
                d="M 154 62 C 168 66 172 82 166 95 C 160 95 154 86 152 74 Z"
                fill={fillFor('side_delts')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('side_delts')}
                opacity={opacityFor('side_delts')}
              />
            </g>

            {/* FRONT DELTS */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('front_delts')}
            >
              <title>Front Delts ({getMuscleData('front_delts').recoveryPct}%)</title>
              <path
                d="M 68 60 L 82 60 L 78 88 L 64 86 Z"
                fill={fillFor('front_delts')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('front_delts')}
                opacity={opacityFor('front_delts')}
              />
              <path
                d="M 152 60 L 138 60 L 142 88 L 156 86 Z"
                fill={fillFor('front_delts')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('front_delts')}
                opacity={opacityFor('front_delts')}
              />
            </g>

            {/* CHEST (Pectorals) */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('chest')}
            >
              <title>Chest ({getMuscleData('chest').recoveryPct}%)</title>
              <path
                d="M 80 60 L 109 62 L 109 100 L 82 102 L 76 84 Z"
                fill={fillFor('chest')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('chest')}
                opacity={opacityFor('chest')}
              />
              <path
                d="M 140 60 L 111 62 L 111 100 L 138 102 L 144 84 Z"
                fill={fillFor('chest')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('chest')}
                opacity={opacityFor('chest')}
              />
            </g>

            {/* LATS (Front V-Taper Wings) */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('lats')}
            >
              <title>Lats ({getMuscleData('lats').recoveryPct}%)</title>
              <path
                d="M 76 96 L 83 102 L 86 134 L 74 122 Z"
                fill={fillFor('lats')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('lats')}
                opacity={opacityFor('lats')}
              />
              <path
                d="M 144 96 L 137 102 L 134 134 L 146 122 Z"
                fill={fillFor('lats')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('lats')}
                opacity={opacityFor('lats')}
              />
            </g>

            {/* BICEPS */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('biceps')}
            >
              <title>Biceps ({getMuscleData('biceps').recoveryPct}%)</title>
              <ellipse
                cx="62"
                cy="112"
                rx="10"
                ry="20"
                transform="rotate(10 62 112)"
                fill={fillFor('biceps')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('biceps')}
                opacity={opacityFor('biceps')}
              />
              <ellipse
                cx="158"
                cy="112"
                rx="10"
                ry="20"
                transform="rotate(-10 158 112)"
                fill={fillFor('biceps')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('biceps')}
                opacity={opacityFor('biceps')}
              />
            </g>

            {/* Forearms (Neutral Outline) */}
            <path
              d="M 52 132 L 66 134 L 60 172 L 46 168 Z"
              fill="#ece2c6"
              stroke="#1d1a16"
              strokeWidth="2.4"
            />
            <path
              d="M 168 132 L 154 134 L 160 172 L 174 168 Z"
              fill="#ece2c6"
              stroke="#1d1a16"
              strokeWidth="2.4"
            />

            {/* ABS / CORE (6-Pack Grid) */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('abs')}
            >
              <title>Abs & Core ({getMuscleData('abs').recoveryPct}%)</title>
              <rect
                x="87"
                y="102"
                width="46"
                height="66"
                rx="8"
                fill={fillFor('abs')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('abs')}
                opacity={opacityFor('abs')}
              />
              <line x1="110" y1="104" x2="110" y2="166" stroke="#1d1a16" strokeWidth="2" />
              <line x1="89" y1="124" x2="131" y2="124" stroke="#1d1a16" strokeWidth="2" />
              <line x1="89" y1="145" x2="131" y2="145" stroke="#1d1a16" strokeWidth="2" />
            </g>

            {/* QUADS (Anterior Thighs) */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('quads')}
            >
              <title>Quads ({getMuscleData('quads').recoveryPct}%)</title>
              <path
                d="M 80 172 L 107 172 L 104 248 L 78 246 C 72 215 74 190 80 172 Z"
                fill={fillFor('quads')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('quads')}
                opacity={opacityFor('quads')}
              />
              <path
                d="M 140 172 L 113 172 L 116 248 L 142 246 C 148 215 146 190 140 172 Z"
                fill={fillFor('quads')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('quads')}
                opacity={opacityFor('quads')}
              />
            </g>

            {/* CALVES (Anterior Tibialis / Gastroc Flare) */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('calves')}
            >
              <title>Calves ({getMuscleData('calves').recoveryPct}%)</title>
              <path
                d="M 80 256 L 102 256 L 98 318 L 83 318 C 76 294 76 274 80 256 Z"
                fill={fillFor('calves')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('calves')}
                opacity={opacityFor('calves')}
              />
              <path
                d="M 140 256 L 118 256 L 122 318 L 137 318 C 144 294 144 274 140 256 Z"
                fill={fillFor('calves')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('calves')}
                opacity={opacityFor('calves')}
              />
            </g>
          </svg>

          <div className="flex flex-wrap justify-center gap-1 mt-1">
            {(['chest', 'front_delts', 'side_delts', 'biceps', 'abs', 'quads'] as MuscleGroup[]).map(
              (m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSelectedMuscle(m)}
                  className={`px-2 py-0.5 text-xs font-bold rounded border border-[#1d1a16] ${
                    selectedMuscle === m ? 'bg-[#f2b632]' : 'bg-[#ece2c6]'
                  }`}
                >
                  {getMuscleData(m).label}
                </button>
              )
            )}
          </div>
        </div>

        {/* POSTERIOR (BACK) */}
        <div className="card-sm bg-[#fbf5e4] flex flex-col items-center p-3">
          <div className="w-full flex items-center justify-between mb-1">
            <span className="font-marker text-base text-[#1d1a16]">
              POSTERIOR (BACK)
            </span>
            <span className="text-xs font-bold text-[#5d5446]">
              Tap muscle region
            </span>
          </div>

          <svg
            viewBox="0 0 220 340"
            className="w-full max-w-[230px] h-auto select-none"
            role="img"
            aria-label="Posterior muscle recovery map"
          >
            {/* Head & Neck Outline */}
            <circle
              cx="110"
              cy="30"
              r="18"
              fill="#ece2c6"
              stroke="#1d1a16"
              strokeWidth="2.8"
            />
            <rect
              x="102"
              y="47"
              width="16"
              height="10"
              rx="3"
              fill="#ece2c6"
              stroke="#1d1a16"
              strokeWidth="2.5"
            />

            {/* UPPER BACK (Traps & Rhomboids Diamond) */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('upper_back')}
            >
              <title>Upper Back & Traps ({getMuscleData('upper_back').recoveryPct}%)</title>
              <polygon
                points="110,52 76,62 92,108 110,116 128,108 144,62"
                fill={fillFor('upper_back')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('upper_back')}
                opacity={opacityFor('upper_back')}
              />
            </g>

            {/* REAR DELTS */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('rear_delts')}
            >
              <title>Rear Delts ({getMuscleData('rear_delts').recoveryPct}%)</title>
              <path
                d="M 62 62 L 78 64 L 76 90 L 58 86 Z"
                fill={fillFor('rear_delts')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('rear_delts')}
                opacity={opacityFor('rear_delts')}
              />
              <path
                d="M 158 62 L 142 64 L 144 90 L 162 86 Z"
                fill={fillFor('rear_delts')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('rear_delts')}
                opacity={opacityFor('rear_delts')}
              />
            </g>

            {/* LATS (V-Taper Back Sweep) */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('lats')}
            >
              <title>Lats ({getMuscleData('lats').recoveryPct}%)</title>
              <path
                d="M 76 90 L 94 108 L 108 158 L 86 154 L 72 118 Z"
                fill={fillFor('lats')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('lats')}
                opacity={opacityFor('lats')}
              />
              <path
                d="M 144 90 L 126 108 L 112 158 L 134 154 L 148 118 Z"
                fill={fillFor('lats')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('lats')}
                opacity={opacityFor('lats')}
              />
            </g>

            {/* TRICEPS (Horseshoe) */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('triceps')}
            >
              <title>Triceps ({getMuscleData('triceps').recoveryPct}%)</title>
              <ellipse
                cx="60"
                cy="112"
                rx="11"
                ry="21"
                transform="rotate(10 60 112)"
                fill={fillFor('triceps')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('triceps')}
                opacity={opacityFor('triceps')}
              />
              <ellipse
                cx="160"
                cy="112"
                rx="11"
                ry="21"
                transform="rotate(-10 160 112)"
                fill={fillFor('triceps')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('triceps')}
                opacity={opacityFor('triceps')}
              />
            </g>

            {/* GLUTES */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('glutes')}
            >
              <title>Glutes ({getMuscleData('glutes').recoveryPct}%)</title>
              <path
                d="M 82 158 L 109 158 L 109 196 L 78 192 C 74 178 76 166 82 158 Z"
                fill={fillFor('glutes')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('glutes')}
                opacity={opacityFor('glutes')}
              />
              <path
                d="M 138 158 L 111 158 L 111 196 L 142 192 C 146 178 144 166 138 158 Z"
                fill={fillFor('glutes')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('glutes')}
                opacity={opacityFor('glutes')}
              />
            </g>

            {/* HAMSTRINGS */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('hamstrings')}
            >
              <title>Hamstrings ({getMuscleData('hamstrings').recoveryPct}%)</title>
              <path
                d="M 80 196 L 107 196 L 104 252 L 80 250 Z"
                fill={fillFor('hamstrings')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('hamstrings')}
                opacity={opacityFor('hamstrings')}
              />
              <path
                d="M 140 196 L 113 196 L 116 252 L 140 250 Z"
                fill={fillFor('hamstrings')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('hamstrings')}
                opacity={opacityFor('hamstrings')}
              />
            </g>

            {/* CALVES (Posterior Gastrocnemius Diamond) */}
            <g
              className="cursor-pointer"
              onClick={() => setSelectedMuscle('calves')}
            >
              <title>Calves ({getMuscleData('calves').recoveryPct}%)</title>
              <path
                d="M 80 256 L 102 256 L 98 318 L 83 318 C 75 292 75 272 80 256 Z"
                fill={fillFor('calves')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('calves')}
                opacity={opacityFor('calves')}
              />
              <path
                d="M 140 256 L 118 256 L 122 318 L 137 318 C 145 292 145 272 140 256 Z"
                fill={fillFor('calves')}
                stroke="#1d1a16"
                strokeWidth={strokeWidthFor('calves')}
                opacity={opacityFor('calves')}
              />
            </g>
          </svg>

          <div className="flex flex-wrap justify-center gap-1 mt-1">
            {(
              [
                'lats',
                'upper_back',
                'rear_delts',
                'triceps',
                'glutes',
                'hamstrings',
                'calves',
              ] as MuscleGroup[]
            ).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSelectedMuscle(m)}
                className={`px-2 py-0.5 text-xs font-bold rounded border border-[#1d1a16] ${
                  selectedMuscle === m ? 'bg-[#f2b632]' : 'bg-[#ece2c6]'
                }`}
              >
                {getMuscleData(m).label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* All 13 Muscle Groups Interactive Chip Grid */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-[#5d5446] mb-2">
          All 13 Muscle Regions — 72h Readiness Matrix
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {recoveryList.map((item) => {
            const isSelected = selectedMuscle === item.muscle;
            const bg = getMuscleFill(item.recoveryPct, item.status);
            return (
              <button
                key={item.muscle}
                type="button"
                onClick={() => setSelectedMuscle(item.muscle)}
                className={`card-sm !p-2.5 text-left transition-transform flex flex-col justify-between min-h-[68px] ${
                  isSelected ? 'ring-2 ring-[#1d1a16] -translate-y-0.5' : ''
                }`}
                style={{ backgroundColor: bg }}
              >
                <div className="flex items-center justify-between gap-1 w-full">
                  <span className="font-marker text-sm text-[#1d1a16] truncate">
                    {item.label}
                  </span>
                  <span className="font-marker text-sm text-[#1d1a16] bg-[#fbf5e4] px-1.5 rounded border border-[#1d1a16]">
                    {item.recoveryPct}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs font-bold text-[#1d1a16]/80 mt-1 w-full">
                  <span>
                    {item.hoursSinceLastTrained !== null
                      ? `${item.hoursSinceLastTrained}h ago`
                      : 'Fresh'}
                  </span>
                  <span>
                    {item.readyInHours > 0 ? `Ready ${item.readyInHours}h` : '✔ Ready'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
