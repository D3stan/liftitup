'use client';

import React, { useEffect, useState } from 'react';
import type { SessionDebriefImpact } from '@/types/domain';
import {
  Trophy,
  Flame,
  Sparkles,
  ArrowRight,
  Copy,
  Check,
  X,
  TrendingUp,
} from 'lucide-react';
import {
  playMechanicalClick,
  playPrFanfare,
  playSetComplete,
} from '@/lib/audio/soundEngine';

export interface SessionDebriefModalProps {
  impact: SessionDebriefImpact | null;
  soundEnabled: boolean;
  onClose: () => void;
}

export default function SessionDebriefModal({
  impact,
  soundEnabled,
  onClose,
}: SessionDebriefModalProps) {
  const [copiedSummary, setCopiedSummary] = useState(false);

  useEffect(() => {
    if (!impact) return;
    if (impact.leveledUp || impact.prsUnlocked.length > 0) {
      playPrFanfare(soundEnabled);
    } else {
      playSetComplete(soundEnabled);
    }
  }, [impact, soundEnabled]);

  if (!impact) return null;

  const handleCopyShareCard = async () => {
    playMechanicalClick(soundEnabled);
    const prLines =
      impact.prsUnlocked.length > 0
        ? `\n🏆 PRs Unlocked (${impact.prsUnlocked.length}): ${impact.prsUnlocked
            .map((p) => `${p.exerciseName} ${p.weightKg}kg × ${p.reps} (e1RM ${Math.round(p.e1rmKg)}kg)`)
            .join(', ')}`
        : '';

    const text = [
      `📓 LIFTITUP — ${impact.session.routineLabel.toUpperCase()}`,
      `⏱️ ${impact.session.durationMinutes} min | 🏋️ ${impact.session.totalSets} sets | 📦 ${Math.round(
        impact.session.totalVolumeKg
      ).toLocaleString()} kg tonnage`,
      `⚡ +${impact.xpEarned} XP → Lv.${impact.newLevel} (${impact.newRank}) | 🔥 ${impact.streakAfter}d Streak`,
      prLines,
      `💡 Coach Note: ${impact.coachTakeaway}`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2500);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div className="sheet-backdrop flex items-end justify-center" onClick={onClose}>
      <div
        className="sheet-panel max-w-xl mx-auto w-full space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Celebratory Banner */}
        <div className="hero-card space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="pill bg-[#1d1a16] text-[#f2b632] text-xs uppercase">
                  SESSION DEBRIEF
                </span>
                {impact.leveledUp && (
                  <span className="pill red text-xs uppercase">
                    <Sparkles className="w-3.5 h-3.5" /> LEVEL UP! LV.{impact.previousLevel} → LV.{impact.newLevel}
                  </span>
                )}
              </div>
              <h2 className="text-2xl font-marker mt-1">
                {impact.session.routineLabel} COMPLETE!
              </h2>
            </div>

            <button
              type="button"
              onClick={() => {
                playMechanicalClick(soundEnabled);
                onClose();
              }}
              aria-label="Close session debrief"
              className="btn icon alt"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="pill green text-base">
              ⚡ +{impact.xpEarned} XP EARNED
            </span>
            <span className="pill text-base">
              🛡️ Rank: {impact.newRank} (Lv.{impact.newLevel})
            </span>
            <span className="pill text-base">
              <Flame className="w-4 h-4 text-[#d9412b]" /> {impact.streakAfter}d Streak
            </span>
          </div>
        </div>

        {/* Before -> After KPI Impact Grid (fit-or-pivot debrief style) */}
        <div className="space-y-2">
          <h3 className="text-lg font-marker uppercase">
            WHAT YOUR SESSION DID (BEFORE → AFTER)
          </h3>
          <div className="grid grid-cols-2 gap-2.5 wobble-grid">
            {impact.beforeAfterKpis.map((kpi, idx) => (
              <div
                key={`${kpi.label}-${idx}`}
                className={`kpi ${kpi.hitTarget ? 'ok' : ''} space-y-1`}
              >
                <div className="text-xs font-bold uppercase text-[#5d5446]">
                  {kpi.label}
                </div>
                <div className="flex items-center gap-1.5 font-marker text-lg">
                  <span className="text-[#5d5446] text-sm">{kpi.before}</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                  <span>{kpi.after}</span>
                </div>
                <div className="text-xs font-bold text-[#2e7d3a]">
                  {kpi.deltaText}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* PRs Unlocked */}
        {impact.prsUnlocked.length > 0 && (
          <div className="card bg-[#cde6c0] space-y-2">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-[#d9412b]" />
              <h3 className="text-lg font-marker">
                NEW PR TROPHIES UNLOCKED ({impact.prsUnlocked.length})
              </h3>
            </div>
            <div className="space-y-1.5">
              {impact.prsUnlocked.map((pr) => (
                <div
                  key={pr.id}
                  className="bg-[#fbf5e4] border-[2.5px] border-[#1d1a16] rounded-[8px] px-3 py-2 flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-bold text-base">{pr.exerciseName}</div>
                    <div className="text-xs text-[#5d5446] font-bold">
                      {pr.weightKg}kg × {pr.reps} reps (Effective:{' '}
                      {Math.round(pr.effectiveLoadKg)}kg)
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="pill gold font-marker text-sm">
                      e1RM {Math.round(pr.e1rmKg)}kg
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Muscle Volume Landmarks Crossed */}
        {impact.muscleLandmarksCrossed.length > 0 && (
          <div className="card-sm space-y-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#2e7d3a]" />
              <span className="font-marker text-base">
                WEEKLY HYPERTROPHY VOLUME IMPACT
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {impact.muscleLandmarksCrossed.map((m) => (
                <span
                  key={m.muscle}
                  className={`pill text-sm ${
                    m.zone === 'mav_optimal'
                      ? 'green'
                      : m.zone === 'mrv_danger'
                      ? 'red'
                      : 'gold'
                  }`}
                >
                  {m.muscle.replace('_', ' ').toUpperCase()}: {m.previousSets} →{' '}
                  {m.newSets} sets
                </span>
              ))}
            </div>
          </div>
        )}

        {/* XP Breakdown */}
        <div className="card-sm space-y-1.5">
          <div className="text-sm font-marker uppercase">XP Breakdown</div>
          <div className="space-y-1">
            {impact.xpBreakdown.map((item, idx) => (
              <div
                key={`${item.label}-${idx}`}
                className="flex items-center justify-between text-base border-b border-dashed border-[#1d1a16]/20 pb-1 last:border-b-0"
              >
                <span>{item.label}</span>
                <span className="font-marker text-[#2e7d3a]">+{item.xp} XP</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sticky Note Coach Takeaway */}
        <div className="note text-base font-bold">
          📌 <span className="font-marker">COACH DEBRIEF:</span>{' '}
          {impact.coachTakeaway}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={handleCopyShareCard}
            className="btn alt flex-1"
          >
            {copiedSummary ? (
              <>
                <Check className="w-5 h-5 text-[#2e7d3a]" /> Copied Card!
              </>
            ) : (
              <>
                <Copy className="w-5 h-5" /> Copy Summary
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              playMechanicalClick(soundEnabled);
              onClose();
            }}
            className="btn big flex-1"
          >
            CONTINUE
          </button>
        </div>
      </div>
    </div>
  );
}
