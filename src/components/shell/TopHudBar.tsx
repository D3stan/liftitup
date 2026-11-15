'use client';

import React from 'react';
import type { UserProfile } from '@/types/domain';
import { Flame, Shield, Volume2, VolumeX, User, Sparkles } from 'lucide-react';

interface TopHudBarProps {
  user: UserProfile;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onOpenProfileModal: () => void;
}

const RANK_COLORS: Record<string, string> = {
  Iron: '#a39e93',
  Bronze: '#cd7f32',
  Silver: '#c0c0c0',
  Gold: '#f2b632',
  Diamond: '#5bc0be',
  Titan: '#d9412b',
  Olympian: '#9b5de5',
};

export default function TopHudBar({
  user,
  soundEnabled,
  onToggleSound,
  onOpenProfileModal,
}: TopHudBarProps) {
  const nextLevelXp =
    user.xpToNextLevel || Math.round(500 * Math.pow(user.level, 1.25));
  const prevLevelXp =
    user.level > 1 ? Math.round(500 * Math.pow(user.level - 1, 1.25)) : 0;
  const levelSpan = Math.max(100, nextLevelXp - prevLevelXp);
  const progressInLevel = Math.max(0, user.xp - prevLevelXp);
  const xpPct = Math.min(100, Math.max(6, Math.round((progressInLevel / levelSpan) * 100)));

  const rankColor = RANK_COLORS[user.rankTier] || '#f2b632';

  return (
    <header
      className="sticky top-0 z-40 border-b-[3px] border-[#1d1a16] bg-[#ece2c6]/95 backdrop-blur-md px-3 pb-2.5"
      style={{ paddingTop: 'calc(10px + var(--sat))' }}
    >
      <div className="mx-auto max-w-2xl">
        {/* Top Row: Brand + Streak/Shields + Sound + Profile Switcher */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="brand text-2xl sm:text-3xl tracking-tight">
              LIFT<span className="text-[#1d1a16]">IT</span>UP
              <span className="brand-badge text-xs">HYPERTROPHY</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Streak Pill */}
            <div
              className="pill gold text-sm"
              title={`Active Streak: ${user.currentStreak} workouts (Best: ${user.bestStreak})`}
            >
              <Flame className="w-4 h-4 text-[#d9412b] fill-[#d9412b]" />
              <span className="font-marker text-base">{user.currentStreak}</span>
              {user.streakShields > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-xs bg-[#fbf5e4] px-1.5 py-0.5 rounded-full border border-[#1d1a16]"
                  title={`${user.streakShields} Streak Shield(s) active`}
                >
                  <Shield className="w-3 h-3 text-[#2b5fa8] fill-[#d4e3f7]" />
                  {user.streakShields}
                </span>
              )}
            </div>

            {/* Sound Synth Toggle */}
            <button
              type="button"
              onClick={onToggleSound}
              className="btn icon alt !w-11 !h-11"
              aria-label={soundEnabled ? 'Mute sound effects' : 'Enable sound effects'}
              title={soundEnabled ? 'Sound & Haptics ON' : 'Sound & Haptics Muted'}
            >
              {soundEnabled ? (
                <Volume2 className="w-5 h-5 text-[#1d1a16]" />
              ) : (
                <VolumeX className="w-5 h-5 text-[#5d5446]" />
              )}
            </button>

            {/* Athlete Profile & Switcher Button */}
            <button
              type="button"
              onClick={onOpenProfileModal}
              className="btn alt !px-2.5 !py-1 !min-h-[44px] text-sm"
              title="Switch Athlete / Account & API Key"
            >
              <User className="w-4 h-4 text-[#d9412b]" />
              <span className="max-w-[88px] sm:max-w-[130px] truncate font-bold">
                {user.displayName.split(' ')[0]}
              </span>
            </button>
          </div>
        </div>

        {/* Bottom Row: Rank Crest + Level + 12-Segment Candy-Striped XP Bar */}
        <div className="mt-2 flex items-center gap-2.5">
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border-[2.5px] border-[#1d1a16] text-xs font-bold shrink-0 shadow-[2px_2px_0_#1d1a16]"
            style={{ backgroundColor: rankColor }}
          >
            <Sparkles className="w-3.5 h-3.5 text-[#1d1a16]" />
            <span className="font-marker uppercase tracking-wider text-[#1d1a16]">
              {user.rankTier}
            </span>
            <span className="bg-[#fbf5e4] px-1.5 rounded border border-[#1d1a16] text-[#1d1a16]">
              Lv.{user.level}
            </span>
          </div>

          <div className="flex-1">
            <div className="bar" title={`${user.xp.toLocaleString()} XP total`}>
              <div
                className="bar-fill gold"
                style={{ width: `${xpPct}%` }}
              />
            </div>
          </div>

          <div className="text-xs font-bold text-[#5d5446] shrink-0 tabular-nums">
            {user.xp.toLocaleString()} XP
          </div>
        </div>
      </div>
    </header>
  );
}
