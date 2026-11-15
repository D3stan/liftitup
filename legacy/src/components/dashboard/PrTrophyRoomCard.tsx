'use client';

import React, { useState } from 'react';
import type { PrRecord, BossMilestone } from '@/types/domain';
import { Trophy, Award, Flame, CheckCircle2, Lock, Sparkles } from 'lucide-react';

interface PrTrophyRoomCardProps {
  prs: PrRecord[];
  bossMilestones: BossMilestone[];
}

export default function PrTrophyRoomCard({
  prs,
  bossMilestones,
}: PrTrophyRoomCardProps) {
  const [viewFilter, setViewFilter] = useState<'all' | 'boss' | 'prs'>('all');

  const unlockedCount = bossMilestones.filter((b) => b.unlocked).length;
  const totalBossXpEarned = bossMilestones
    .filter((b) => b.unlocked)
    .reduce((acc, b) => acc + b.xpReward, 0);

  return (
    <section className="card space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b-[2.5px] border-[#1d1a16] pb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl sm:text-2xl tracking-wide text-[#1d1a16]">
              PR TROPHY ROOM & BOSS MILESTONES
            </h2>
            <span className="pill gold text-xs">
              <Trophy className="w-3.5 h-3.5 text-[#d9412b]" />
              HALL OF RECORDS
            </span>
          </div>
          <p className="text-sm text-[#5d5446] font-bold">
            Every broken e1RM record & Boss Milestone awards bonus XP toward your Hypertrophy Rank
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="pill green text-xs">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#2e7d3a]" />
            {unlockedCount}/{bossMilestones.length} Bosses Slain
          </span>
          <span className="pill gold text-xs">
            +{totalBossXpEarned} Boss XP
          </span>
        </div>
      </div>

      {/* Filter Switcher */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setViewFilter('all')}
          className={`btn !min-h-[44px] !px-3.5 !py-1 text-sm ${
            viewFilter === 'all' ? '' : 'alt'
          }`}
        >
          🏆 All Trophies & Bosses
        </button>
        <button
          type="button"
          onClick={() => setViewFilter('boss')}
          className={`btn !min-h-[44px] !px-3.5 !py-1 text-sm ${
            viewFilter === 'boss' ? '' : 'alt'
          }`}
        >
          ⚔️ Boss Milestones ({unlockedCount}/{bossMilestones.length})
        </button>
        <button
          type="button"
          onClick={() => setViewFilter('prs')}
          className={`btn !min-h-[44px] !px-3.5 !py-1 text-sm ${
            viewFilter === 'prs' ? '' : 'alt'
          }`}
        >
          🔥 Lift PR Records ({prs.length})
        </button>
      </div>

      {/* 1. GAMIFIED BOSS MILESTONES */}
      {(viewFilter === 'all' || viewFilter === 'boss') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg text-[#1d1a16] flex items-center gap-1.5">
              <span>⚔️ STRENGTH & HYPERTROPHY BOSS MILESTONES</span>
            </h3>
            <span className="text-xs font-bold text-[#5d5446]">
              12-segment progress bars
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 wobble-grid">
            {bossMilestones.map((boss) => {
              const pct = Math.min(100, Math.max(4, Math.round(boss.progressPct)));
              return (
                <div
                  key={boss.id}
                  className={`card-sm border-[3px] border-[#1d1a16] flex flex-col justify-between gap-2.5 ${
                    boss.unlocked ? 'bg-[#cde6c0]/55' : 'bg-[#fbf5e4]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5">
                      <div
                        className={`w-11 h-11 rounded-lg border-[2.5px] border-[#1d1a16] flex items-center justify-center text-xl shrink-0 shadow-[2px_2px_0_#1d1a16] ${
                          boss.unlocked ? 'bg-[#f2b632]' : 'bg-[#ece2c6]'
                        }`}
                      >
                        {boss.icon || '🏋️'}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-marker text-base text-[#1d1a16]">
                            {boss.title}
                          </span>
                          {boss.unlocked ? (
                            <span className="pill green !text-[11px] !py-0 !px-2">
                              ✔ UNLOCKED
                            </span>
                          ) : (
                            <span className="pill !text-[11px] !py-0 !px-2 text-[#5d5446]">
                              <Lock className="w-3 h-3" /> {pct}%
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-bold text-[#5d5446]">
                          {boss.subtitle} — <span className="text-[#1d1a16]">{boss.targetDescription}</span>
                        </p>
                      </div>
                    </div>

                    <span className="pill gold !text-xs !py-0.5 !px-2 shrink-0">
                      +{boss.xpReward} XP
                    </span>
                  </div>

                  {/* Progress Bar & Current Value */}
                  <div className="space-y-1">
                    <div className="bar !h-4">
                      <div
                        className={`bar-fill ${boss.unlocked ? 'green' : 'gold'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-[#1d1a16]">
                        Current: <strong>{boss.currentValueText}</strong>
                      </span>
                      <span className={boss.unlocked ? 'text-[#2e7d3a]' : 'text-[#5d5446]'}>
                        {boss.unlocked ? 'Boss Defeated! 🏆' : `${100 - pct}% to go`}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. ALL-TIME PERSONAL RECORDS WALL */}
      {(viewFilter === 'all' || viewFilter === 'prs') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg text-[#1d1a16] flex items-center gap-1.5">
              <Flame className="w-5 h-5 text-[#d9412b] fill-[#d9412b]" />
              <span>VERIFIED PERSONAL RECORDS (ALL-TIME BESTS)</span>
            </h3>
            <span className="text-xs font-bold text-[#5d5446]">
              Sorted by latest achievement
            </span>
          </div>

          {prs.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 wobble-grid">
              {prs.map((pr) => {
                const delta =
                  pr.previousBestE1rmKg && pr.previousBestE1rmKg > 0
                    ? Number((pr.e1rmKg - pr.previousBestE1rmKg).toFixed(1))
                    : null;

                const prTypeBadge =
                  pr.prType === 'e1rm'
                    ? 'EST. 1RM PR'
                    : pr.prType === 'weight_for_reps'
                    ? 'REP MAX PR'
                    : 'VOLUME PR';

                return (
                  <div
                    key={pr.id}
                    className="kpi ok flex flex-col justify-between gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="pill gold !text-[11px] !py-0.5 !px-2">
                            <Sparkles className="w-3 h-3 text-[#d9412b]" />
                            {prTypeBadge}
                          </span>
                          <span className="text-xs font-bold text-[#5d5446]">
                            {pr.achievedAt.slice(0, 10)}
                          </span>
                        </div>
                        <div className="font-marker text-lg text-[#1d1a16] mt-1">
                          {pr.exerciseName}
                        </div>
                      </div>

                      <Award className="w-6 h-6 text-[#d9412b] shrink-0" />
                    </div>

                    <div className="bg-[#fbf5e4] border-2 border-[#1d1a16] rounded-lg px-3 py-2 flex items-center justify-between gap-2 shadow-[2px_2px_0_#1d1a16]">
                      <div>
                        <div className="text-[11px] font-bold uppercase text-[#5d5446]">
                          Logged Set
                        </div>
                        <div className="font-marker text-base text-[#1d1a16]">
                          {pr.weightKg}kg × {pr.reps} reps
                          {pr.effectiveLoadKg > pr.weightKg && (
                            <span className="text-xs font-sans font-bold text-[#2b5fa8] ml-1">
                              ({pr.effectiveLoadKg.toFixed(1)}kg eff.)
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[11px] font-bold uppercase text-[#2e7d3a]">
                          Peak e1RM
                        </div>
                        <div className="font-marker text-lg text-[#1d1a16]">
                          {pr.e1rmKg.toFixed(1)} kg
                        </div>
                        {delta !== null && delta > 0 && (
                          <div className="text-xs font-bold text-[#2e7d3a]">
                            ▲ +{delta} kg e1RM
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card-sm text-center py-6 font-bold text-[#5d5446]">
              No PRs recorded yet — log your first working set above target reps to claim a trophy!
            </div>
          )}
        </div>
      )}
    </section>
  );
}
