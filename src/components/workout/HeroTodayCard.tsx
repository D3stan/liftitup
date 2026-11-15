'use client';

import React from 'react';
import type {
  PrecompiledSession,
  PrecompiledSlot,
  Schedule,
} from '@/types/domain';
import {
  Play,
  Zap,
  ArrowLeftRight,
  Calendar,
  Clock,
  CheckCircle2,
  Dumbbell,
  Scale,
} from 'lucide-react';
import { playMechanicalClick } from '@/lib/audio/soundEngine';

export interface HeroTodayCardProps {
  session: PrecompiledSession | null;
  schedule: Schedule | null;
  userBodyweightKg: number;
  isSessionActive: boolean;
  isQuickLogging: boolean;
  soundEnabled: boolean;
  onSelectDay: (dayOfWeek: number) => void;
  onStartSession: () => void;
  onQuickCompleteSession: () => void;
  onOpenSwapSheet: (slot: PrecompiledSlot) => void;
  onOpenScheduleBuilder: () => void;
}

const SHORT_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getBadgeIcon(type: PrecompiledSlot['progressionType']): string {
  switch (type) {
    case 'load_up':
      return '🚀';
    case 'add_rep':
      return '📈';
    case 'variation_equiv':
      return '🔄';
    case 'hold':
      return '🛡️';
    default:
      return '✨';
  }
}

export default function HeroTodayCard({
  session,
  schedule,
  userBodyweightKg,
  isSessionActive,
  isQuickLogging,
  soundEnabled,
  onSelectDay,
  onStartSession,
  onQuickCompleteSession,
  onOpenSwapSheet,
  onOpenScheduleBuilder,
}: HeroTodayCardProps) {
  const activeDayOfWeek = session?.dayOfWeek ?? ((new Date().getDay() + 6) % 7);

  return (
    <div className="space-y-3">
      {/* Mon..Sun 7-Day Split Quick Switcher */}
      <div className="grid grid-cols-7 gap-1.5">
        {SHORT_DAY_LABELS.map((dayLabel, idx) => {
          const schedDay = schedule?.days.find((d) => d.dayOfWeek === idx);
          const isSelected = activeDayOfWeek === idx;
          const isRest = schedDay ? schedDay.isRestDay : false;
          const shortTag = schedDay
            ? schedDay.isRestDay
              ? 'Rest'
              : schedDay.routineLabel.split(/[—\-]/)[0].trim().slice(0, 7)
            : 'Train';

          return (
            <button
              key={dayLabel}
              type="button"
              onClick={() => {
                playMechanicalClick(soundEnabled);
                onSelectDay(idx);
              }}
              className={`min-h-[52px] px-1 py-1.5 rounded-[8px] border-[2.5px] border-[#1d1a16] flex flex-col items-center justify-center text-center transition-transform duration-75 cursor-pointer ${
                isSelected
                  ? 'bg-[#f2b632] -translate-y-0.5'
                  : isRest
                  ? 'bg-[#ece2c6] text-[#5d5446]'
                  : 'bg-[#fbf5e4]'
              }`}
              style={{
                boxShadow: isSelected ? '3px 3px 0 var(--ink)' : '2px 2px 0 var(--ink)',
              }}
            >
              <span className="font-marker text-xs uppercase">{dayLabel}</span>
              <span className="text-[11px] font-bold truncate w-full leading-tight">
                {shortTag}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Tilted Gold Hero Card */}
      {!session ? (
        <div className="hero-card space-y-2">
          <h2 className="text-2xl font-marker">COMPILING TODAY&apos;S SESSION...</h2>
          <p className="text-base font-bold">
            Running Smart Double-Progression & Variation Equivalence math...
          </p>
        </div>
      ) : session.isRestDay ? (
        <div className="hero-card space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="pill bg-[#1d1a16] text-[#f2b632] text-xs uppercase">
                ANABOLIC GROWTH & RECOVERY DAY
              </span>
              <h2 className="text-3xl font-marker mt-1">
                {session.routineLabel || 'Scheduled Rest Day'}
              </h2>
            </div>
            <span className="pill text-xs">
              <Scale className="w-3.5 h-3.5" /> BW {userBodyweightKg}kg
            </span>
          </div>

          <p className="text-base font-bold leading-snug">
            Muscle protein synthesis peaks 24–48h post-training. Want to train today anyway? Tap any training day pill above (Mon–Sun) or shift your weekly split by ±1 day!
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                playMechanicalClick(soundEnabled);
                const firstTrainingDay =
                  schedule?.days.find((d) => !d.isRestDay)?.dayOfWeek ?? 0;
                onSelectDay(firstTrainingDay);
              }}
              className="btn alt flex-1"
            >
              <Dumbbell className="w-4 h-4" /> Load Next Training Day
            </button>
            <button
              type="button"
              onClick={() => {
                playMechanicalClick(soundEnabled);
                onOpenScheduleBuilder();
              }}
              className="btn alt flex-1"
            >
              <Calendar className="w-4 h-4" /> Edit / Shift Split
            </button>
          </div>
        </div>
      ) : (
        <div className="hero-card space-y-3.5">
          {/* Top Status Row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="pill bg-[#1d1a16] text-[#f2b632] text-xs uppercase font-marker">
                PRECOMPILED HYPERTROPHY SESSION
              </span>
              {session.alreadyCompletedToday && (
                <span className="pill green text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Logged Today
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="pill text-xs py-0.5 px-2.5">
                <Clock className="w-3.5 h-3.5" /> ~{session.estimatedDurationMin}m
              </span>
              <span className="pill text-xs py-0.5 px-2.5">
                <Scale className="w-3.5 h-3.5" /> BW {userBodyweightKg}kg
              </span>
            </div>
          </div>

          {/* Routine Title & Focus Muscles */}
          <div className="space-y-1.5">
            <h1 className="text-3xl sm:text-4xl font-marker tracking-wide">
              {session.routineLabel}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              {session.focusMuscles.map((muscle) => (
                <span
                  key={muscle}
                  className="pill text-xs py-0.5 px-2.5 uppercase bg-[#fbf5e4]"
                >
                  🎯 {muscle.replace(/_/g, ' ')}
                </span>
              ))}
              <span className="text-sm font-bold text-[#1d1a16]/80 pl-1">
                • {session.slots.length} exercises (
                {session.slots.reduce((acc, s) => acc + s.targetSets, 0)} working sets)
              </span>
            </div>
          </div>

          {/* Precompiled Exercise Slot Preview Chips with 1-Tap Swap */}
          <div className="space-y-2">
            {session.slots.map((slot) => {
              const firstSet = slot.sets[0];
              const isBwPlus = slot.exercise.loadType === 'bodyweight_plus';
              const targetSummary = firstSet
                ? isBwPlus
                  ? `BW + ${firstSet.targetWeightKg}kg × ${firstSet.targetReps}`
                  : `${firstSet.targetWeightKg}kg × ${firstSet.targetReps}`
                : `${slot.targetSets}×${slot.repRangeMin}-${slot.repRangeMax}`;

              return (
                <div
                  key={`${slot.scheduleSlotId}-${slot.slotIndex}`}
                  className="bg-[#fbf5e4] border-[2.5px] border-[#1d1a16] rounded-[10px] px-3 py-2 flex items-center justify-between gap-2"
                  style={{ boxShadow: '3px 3px 0 var(--ink)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-marker text-base truncate">
                        {slot.slotIndex + 1}. {slot.exercise.name}
                      </span>
                      <span className="pill text-xs py-0 px-2 bg-[#fbedba]">
                        {getBadgeIcon(slot.progressionType)} {slot.progressionBadge}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-[#5d5446]">
                      {slot.targetSets} sets • Target:{' '}
                      <strong className="text-[#1d1a16]">{targetSummary}</strong> @ RIR{' '}
                      {slot.targetRir}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      playMechanicalClick(soundEnabled);
                      onOpenSwapSheet(slot);
                    }}
                    className="btn blue !min-h-[44px] !px-2.5 !py-1 text-sm shrink-0"
                    title="Swap variation (e.g. Pulley ↔ Weighted Chin-up)"
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                    <span>Swap</span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                playMechanicalClick(soundEnabled);
                onStartSession();
              }}
              className="btn red big sm:col-span-7 w-full"
            >
              <Play className="w-5 h-5 fill-current" />
              {isSessionActive
                ? 'JUMP TO ACTIVE SET LOGGER'
                : 'START / LOG WORKOUT'}
            </button>

            <button
              type="button"
              disabled={isQuickLogging}
              onClick={() => {
                playMechanicalClick(soundEnabled);
                onQuickCompleteSession();
              }}
              className="btn alt sm:col-span-5 !min-h-[52px] w-full text-base"
              title="Completed all target sets as precompiled? Log the whole session in 1 tap!"
            >
              <Zap className="w-4 h-4 text-[#d9412b]" />
              {isQuickLogging ? 'Logging...' : '1-Tap Log Default'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
