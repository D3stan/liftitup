'use client';

import React, { useState, useMemo } from 'react';
import type {
  UserProfile,
  WorkoutSession,
  MuscleVolumeLandmark,
  PrRecord,
} from '@/types/domain';
import {
  Download,
  Copy,
  Check,
  Share2,
  Flame,
  Shield,
  Trophy,
  Sparkles,
  Dumbbell,
} from 'lucide-react';

interface ShareableWorkoutCardProps {
  user: UserProfile;
  recentSessions: WorkoutSession[];
  volumeLandmarks: MuscleVolumeLandmark[];
  recentPrs: PrRecord[];
  weeklyTonnageKg: number;
  weeklySessionsCompleted: number;
  weeklySessionsTarget: number;
  onShowToast: (message: string) => void;
}

export default function ShareableWorkoutCard({
  user,
  recentSessions,
  volumeLandmarks,
  recentPrs,
  weeklyTonnageKg,
  weeklySessionsCompleted,
  weeklySessionsTarget,
  onShowToast,
}: ShareableWorkoutCardProps) {
  const [selectedSessionIdx, setSelectedSessionIdx] = useState<number>(0);
  const [cardMode, setCardMode] = useState<'session' | 'weekly'>('session');
  const [copied, setCopied] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);

  const activeSession: WorkoutSession | null =
    recentSessions[selectedSessionIdx] || recentSessions[0] || null;

  // Group top sets by exercise for the active session
  const sessionTopSets = useMemo(() => {
    if (!activeSession || !activeSession.sets) return [];
    const byExercise = new Map<
      string,
      {
        exerciseName: string;
        bestWeightKg: number;
        bestEffectiveKg: number;
        bestReps: number;
        bestE1rmKg: number;
        setsCount: number;
        hasPr: boolean;
      }
    >();

    for (const s of activeSession.sets) {
      const name = s.exerciseName || s.exerciseId;
      const e1rm =
        s.e1rmKg ||
        Math.round((s.effectiveLoadKg || s.weightKg) * (1 + Math.min(s.reps + s.rir, 15) / 30) * 10) / 10;
      const existing = byExercise.get(s.exerciseId);
      if (!existing) {
        byExercise.set(s.exerciseId, {
          exerciseName: name,
          bestWeightKg: s.weightKg,
          bestEffectiveKg: s.effectiveLoadKg || s.weightKg,
          bestReps: s.reps,
          bestE1rmKg: e1rm,
          setsCount: 1,
          hasPr: Boolean(s.isPr),
        });
      } else {
        existing.setsCount += 1;
        if (s.isPr) existing.hasPr = true;
        if (e1rm > existing.bestE1rmKg) {
          existing.bestWeightKg = s.weightKg;
          existing.bestEffectiveKg = s.effectiveLoadKg || s.weightKg;
          existing.bestReps = s.reps;
          existing.bestE1rmKg = e1rm;
        }
      }
    }

    return Array.from(byExercise.values()).slice(0, 5);
  }, [activeSession]);

  const mavMuscles = useMemo(
    () =>
      volumeLandmarks
        .filter((l) => l.zone === 'mav_sweet_spot')
        .map((l) => l.label),
    [volumeLandmarks]
  );

  // Build plain-text share summary for WhatsApp / Telegram / Discord / iMessage
  const shareTextSummary = useMemo(() => {
    if (cardMode === 'session' && activeSession) {
      const lines = [
        `📓 LIFTITUP HYPERTROPHY LOG — ${activeSession.routineLabel.toUpperCase()}`,
        `👤 ${user.displayName} • ${user.rankTier} Rank (Lv.${user.level}) • 🔥 ${user.currentStreak}d Streak`,
        `⏱ ${activeSession.durationMinutes} min • 🏋️ ${activeSession.totalVolumeKg.toLocaleString()} kg Tonnage • ${activeSession.totalSets} Working Sets`,
        `⚡ +${activeSession.xpEarned} XP Earned${
          activeSession.prsCount > 0 ? ` • 🏆 ${activeSession.prsCount} NEW PR!` : ''
        }`,
        '',
        '🔥 TOP WORKING SETS:',
        ...sessionTopSets.map(
          (t) =>
            `• ${t.exerciseName}: ${t.bestWeightKg}kg × ${t.bestReps} (${t.setsCount} sets | e1RM ${t.bestE1rmKg.toFixed(1)}kg)${
              t.hasPr ? ' 🏆 PR' : ''
            }`
        ),
        '',
        `🟢 MAV Optimal Muscles (${mavMuscles.length}/13): ${
          mavMuscles.slice(0, 6).join(', ') || 'Building volume'
        }`,
        `🔗 Tracked on LiftItUp (lift.0xpuddu.com)`,
      ];
      return lines.join('\n');
    }

    const lines = [
      `📊 LIFTITUP WEEKLY HYPERTROPHY REPORT`,
      `👤 ${user.displayName} • ${user.rankTier} Rank (Lv.${user.level}) • 🔥 ${user.currentStreak}d Streak (🛡️ ${user.streakShields})`,
      `✅ Sessions: ${weeklySessionsCompleted}/${weeklySessionsTarget} Completed`,
      `🏋️ Weekly Volume: ${weeklyTonnageKg.toLocaleString()} kg Total Tonnage`,
      `🟢 Muscles in MAV Sweet Spot (${mavMuscles.length}/13): ${
        mavMuscles.join(', ') || 'In Progress'
      }`,
      '',
      '🏆 RECENT PR TROPHIES:',
      ...recentPrs.slice(0, 4).map(
        (p) =>
          `• ${p.exerciseName}: ${p.weightKg}kg × ${p.reps} (e1RM ${p.e1rmKg.toFixed(1)}kg)`
      ),
      '',
      `🔗 LiftItUp — Science-Based Hypertrophy Notebook (lift.0xpuddu.com)`,
    ];
    return lines.join('\n');
  }, [
    cardMode,
    activeSession,
    user,
    sessionTopSets,
    mavMuscles,
    weeklySessionsCompleted,
    weeklySessionsTarget,
    weeklyTonnageKg,
    recentPrs,
  ]);

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(shareTextSummary);
      setCopied(true);
      onShowToast('Copied workout summary to clipboard!');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      onShowToast('Could not copy automatically — select text below.');
    }
  };

  // Render high-resolution Ink-on-Paper Trading Card directly to HTML5 <canvas> and download PNG
  const handleDownloadPng = () => {
    setDownloading(true);
    try {
      const canvas = document.createElement('canvas');
      const W = 900;
      const H = 1120;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setDownloading(false);
        return;
      }

      // 1. Warm Vintage Notebook Paper Background (#ece2c6) + Dotted Grid
      ctx.fillStyle = '#ece2c6';
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = 'rgba(29, 26, 22, 0.14)';
      for (let x = 20; x < W; x += 24) {
        for (let y = 20; y < H; y += 24) {
          ctx.beginPath();
          ctx.arc(x, y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Helper for hard cartoon offset rect
      const drawCartoonBox = (
        x: number,
        y: number,
        w: number,
        h: number,
        fill: string,
        shadowOffset = 8
      ) => {
        ctx.fillStyle = '#1d1a16';
        ctx.fillRect(x + shadowOffset, y + shadowOffset, w, h);
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#1d1a16';
        ctx.lineWidth = 5;
        ctx.strokeRect(x, y, w, h);
      };

      // 2. Outer Trading Card Frame
      drawCartoonBox(42, 42, W - 84, H - 84, '#fbf5e4', 10);

      // 3. Top Gold Header Banner
      drawCartoonBox(74, 74, W - 148, 150, '#f2b632', 6);

      // Brand Title
      ctx.fillStyle = '#d9412b';
      ctx.font = '900 44px "Permanent Marker", "Comic Sans MS", sans-serif';
      ctx.fillText('LIFT IT UP', 102, 134);

      // Rank & Level Pill on Right
      drawCartoonBox(W - 330, 94, 228, 52, '#fbf5e4', 4);
      ctx.fillStyle = '#1d1a16';
      ctx.font = 'bold 24px "Permanent Marker", sans-serif';
      ctx.fillText(`★ ${user.rankTier.toUpperCase()} • LV.${user.level}`, W - 312, 128);

      // Athlete Name & Streak Subheader
      ctx.fillStyle = '#1d1a16';
      ctx.font = 'bold 26px "Patrick Hand", sans-serif';
      const titleText =
        cardMode === 'session' && activeSession
          ? `${activeSession.routineLabel} • ${activeSession.completedAt.slice(0, 10)}`
          : `Weekly Hypertrophy Report • ${weeklySessionsCompleted}/${weeklySessionsTarget} Sessions`;
      ctx.fillText(titleText, 102, 178);

      ctx.font = 'bold 22px "Patrick Hand", sans-serif';
      ctx.fillStyle = '#5d5446';
      ctx.fillText(
        `Athlete: ${user.displayName} (${user.bodyweightKg}kg)   |   🔥 ${user.currentStreak}d Streak   |   🛡️ ${user.streakShields} Shields`,
        102,
        208
      );

      // 4. 3 KPI Tiles Row
      const kpiY = 252;
      const kpiW = 236;
      const kpiH = 115;

      const kpi1Label = cardMode === 'session' ? 'SESSION TONNAGE' : 'WEEKLY TONNAGE';
      const kpi1Val =
        cardMode === 'session' && activeSession
          ? `${activeSession.totalVolumeKg.toLocaleString()} kg`
          : `${weeklyTonnageKg.toLocaleString()} kg`;

      const kpi2Label = cardMode === 'session' ? 'WORKING SETS' : 'MAV MUSCLES';
      const kpi2Val =
        cardMode === 'session' && activeSession
          ? `${activeSession.totalSets} Sets (${activeSession.durationMinutes}m)`
          : `${mavMuscles.length} / 13 Optimal`;

      const kpi3Label = cardMode === 'session' ? 'XP & PRs EARNED' : 'TOTAL ATHLETE XP';
      const kpi3Val =
        cardMode === 'session' && activeSession
          ? `+${activeSession.xpEarned} XP (${activeSession.prsCount} PR)`
          : `${user.xp.toLocaleString()} XP`;

      [
        { x: 74, label: kpi1Label, val: kpi1Val, bg: '#cde6c0' },
        { x: 332, label: kpi2Label, val: kpi2Val, bg: '#fbf5e4' },
        { x: 590, label: kpi3Label, val: kpi3Val, bg: '#fff27a' },
      ].forEach((tile) => {
        drawCartoonBox(tile.x, kpiY, kpiW, kpiH, tile.bg, 5);
        ctx.fillStyle = '#5d5446';
        ctx.font = 'bold 18px "Patrick Hand", sans-serif';
        ctx.fillText(tile.label, tile.x + 18, kpiY + 36);
        ctx.fillStyle = '#1d1a16';
        ctx.font = 'bold 30px "Permanent Marker", sans-serif';
        ctx.fillText(tile.val, tile.x + 18, kpiY + 84);
      });

      // 5. Top Working Sets / PR Highlights Section
      ctx.fillStyle = '#1d1a16';
      ctx.font = 'bold 28px "Permanent Marker", sans-serif';
      ctx.fillText(
        cardMode === 'session'
          ? 'TOP WORKING SETS & BIOMECHANICAL e1RMs'
          : 'ALL-TIME PERSONAL RECORD HIGHLIGHTS',
        74,
        422
      );

      let rowY = 444;
      if (cardMode === 'session' && sessionTopSets.length > 0) {
        sessionTopSets.slice(0, 5).forEach((item, idx) => {
          drawCartoonBox(
            74,
            rowY,
            W - 148,
            78,
            item.hasPr ? '#cde6c0' : '#fbf5e4',
            4
          );
          ctx.fillStyle = '#1d1a16';
          ctx.font = 'bold 25px "Permanent Marker", sans-serif';
          ctx.fillText(
            `${idx + 1}. ${item.exerciseName}`,
            96,
            rowY + 34
          );

          ctx.fillStyle = '#5d5446';
          ctx.font = 'bold 21px "Patrick Hand", sans-serif';
          ctx.fillText(
            `${item.setsCount} working sets  •  Top Set: ${item.bestWeightKg}kg × ${item.bestReps} reps`,
            96,
            rowY + 64
          );

          ctx.fillStyle = '#2e7d3a';
          ctx.font = 'bold 26px "Permanent Marker", sans-serif';
          const rightText = `e1RM ${item.bestE1rmKg.toFixed(1)}kg${
            item.hasPr ? ' 🏆' : ''
          }`;
          ctx.fillText(rightText, W - 310, rowY + 48);

          rowY += 94;
        });
      } else {
        recentPrs.slice(0, 5).forEach((pr, idx) => {
          drawCartoonBox(74, rowY, W - 148, 78, '#cde6c0', 4);
          ctx.fillStyle = '#1d1a16';
          ctx.font = 'bold 25px "Permanent Marker", sans-serif';
          ctx.fillText(`${idx + 1}. ${pr.exerciseName}`, 96, rowY + 34);

          ctx.fillStyle = '#5d5446';
          ctx.font = 'bold 21px "Patrick Hand", sans-serif';
          ctx.fillText(
            `Logged: ${pr.weightKg}kg × ${pr.reps} reps (${pr.achievedAt.slice(0, 10)})`,
            96,
            rowY + 64
          );

          ctx.fillStyle = '#1d1a16';
          ctx.font = 'bold 26px "Permanent Marker", sans-serif';
          ctx.fillText(`e1RM ${pr.e1rmKg.toFixed(1)}kg 🏆`, W - 305, rowY + 48);
          rowY += 94;
        });
      }

      // 6. Sticky Note Footer Banner
      drawCartoonBox(74, H - 170, W - 148, 86, '#fff27a', 5);
      ctx.fillStyle = '#1d1a16';
      ctx.font = 'bold 22px "Patrick Hand", sans-serif';
      ctx.fillText(
        `🟢 MAV Sweet Spot Muscles (${mavMuscles.length}/13): ${
          mavMuscles.slice(0, 6).join(', ') || 'Logging volume'
        }`,
        96,
        H - 132
      );
      ctx.fillStyle = '#d9412b';
      ctx.font = 'bold 20px "Permanent Marker", sans-serif';
      ctx.fillText(
        'LIFT.0XPUDDU.COM — SCIENCE-BASED HYPERTROPHY & VARIATION ENGINE',
        96,
        H - 100
      );

      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `liftitup-${user.username}-${new Date()
        .toISOString()
        .slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
      onShowToast('Downloaded Ink-on-Paper Workout Trading Card PNG!');
    } catch (e) {
      console.error('Failed to export PNG:', e);
      onShowToast('PNG export failed — try Copy Text Summary.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="card space-y-4">
      {/* Header & Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b-[2.5px] border-[#1d1a16] pb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl sm:text-2xl tracking-wide text-[#1d1a16]">
              SHAREABLE WORKOUT TRADING CARD
            </h2>
            <span className="pill gold text-xs">
              <Share2 className="w-3.5 h-3.5" />
              PNG + TEXT EXPORT
            </span>
          </div>
          <p className="text-sm text-[#5d5446] font-bold">
            Export an Ink-on-Paper cartoon summary card or copy formatted text for gym group chats
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCardMode('session')}
            className={`btn !min-h-[44px] !px-3 !py-1 text-sm ${
              cardMode === 'session' ? '' : 'alt'
            }`}
          >
            🏋️ Latest Workout Card
          </button>
          <button
            type="button"
            onClick={() => setCardMode('weekly')}
            className={`btn !min-h-[44px] !px-3 !py-1 text-sm ${
              cardMode === 'weekly' ? '' : 'alt'
            }`}
          >
            📊 Weekly Report Card
          </button>
        </div>
      </div>

      {/* Session Picker if in Session Mode */}
      {cardMode === 'session' && recentSessions.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold uppercase text-[#5d5446] mr-1">
            Select Session:
          </span>
          {recentSessions.slice(0, 5).map((sess, idx) => (
            <button
              key={sess.id}
              type="button"
              onClick={() => setSelectedSessionIdx(idx)}
              className={`pill cursor-pointer !min-h-[38px] ${
                selectedSessionIdx === idx ? 'gold' : ''
              }`}
            >
              {sess.completedAt.slice(5, 10)} • {sess.routineLabel.split('—')[0].trim()}
            </button>
          ))}
        </div>
      )}

      {/* LIVE TRADING CARD PREVIEW (Ink-on-Paper Hero Styling) */}
      <div className="hero-card !bg-[#fbf5e4] !p-4 sm:!p-5 space-y-4">
        {/* Top Trading Card Banner */}
        <div className="bg-[#f2b632] border-[3px] border-[#1d1a16] rounded-xl p-3.5 shadow-[4px_4px_0_#1d1a16] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="brand text-2xl">
                LIFT<span className="text-[#1d1a16]">IT</span>UP
              </span>
              <span className="pill !bg-[#fbf5e4] !text-xs">
                <Sparkles className="w-3.5 h-3.5 text-[#d9412b]" />
                {user.rankTier} • Lv.{user.level}
              </span>
              <span className="pill !bg-[#fbf5e4] !text-xs">
                <Flame className="w-3.5 h-3.5 text-[#d9412b] fill-[#d9412b]" />
                {user.currentStreak}d Streak
              </span>
              {user.streakShields > 0 && (
                <span className="pill !bg-[#fbf5e4] !text-xs">
                  <Shield className="w-3.5 h-3.5 text-[#2b5fa8]" />
                  {user.streakShields}
                </span>
              )}
            </div>
            <h3 className="text-xl sm:text-2xl text-[#1d1a16] mt-1">
              {cardMode === 'session' && activeSession
                ? activeSession.routineLabel
                : `Weekly Hypertrophy Report (${weeklySessionsCompleted}/${weeklySessionsTarget} Sessions)`}
            </h3>
            <p className="text-xs sm:text-sm font-bold text-[#1d1a16]/80">
              Athlete: <strong>{user.displayName}</strong> ({user.bodyweightKg}kg BW) •{' '}
              {cardMode === 'session' && activeSession
                ? activeSession.completedAt.slice(0, 10)
                : 'Last 7 Days Rolling Window'}
            </p>
          </div>
        </div>

        {/* 3 KPI Stat Tiles inside Trading Card */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="kpi ok text-center">
            <div className="text-[11px] font-bold uppercase text-[#5d5446]">
              {cardMode === 'session' ? 'Session Tonnage' : 'Weekly Tonnage'}
            </div>
            <div className="font-marker text-lg sm:text-xl text-[#1d1a16]">
              {cardMode === 'session' && activeSession
                ? `${activeSession.totalVolumeKg.toLocaleString()} kg`
                : `${weeklyTonnageKg.toLocaleString()} kg`}
            </div>
          </div>

          <div className="kpi text-center">
            <div className="text-[11px] font-bold uppercase text-[#5d5446]">
              {cardMode === 'session' ? 'Working Sets' : 'MAV Sweet Spot'}
            </div>
            <div className="font-marker text-lg sm:text-xl text-[#1d1a16]">
              {cardMode === 'session' && activeSession
                ? `${activeSession.totalSets} sets (${activeSession.durationMinutes}m)`
                : `${mavMuscles.length} / 13 Muscles`}
            </div>
          </div>

          <div className="kpi !bg-[#fff27a] text-center">
            <div className="text-[11px] font-bold uppercase text-[#5d5446]">
              {cardMode === 'session' ? 'XP & PRs' : 'Total XP'}
            </div>
            <div className="font-marker text-lg sm:text-xl text-[#1d1a16]">
              {cardMode === 'session' && activeSession
                ? `+${activeSession.xpEarned} XP`
                : `${user.xp.toLocaleString()} XP`}
            </div>
          </div>
        </div>

        {/* Top Sets List inside Card */}
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-[#5d5446] flex items-center gap-1.5">
            <Dumbbell className="w-3.5 h-3.5 text-[#1d1a16]" />
            <span>
              {cardMode === 'session'
                ? 'Top Working Sets & Estimated 1RMs'
                : 'Recent Personal Record Lifts'}
            </span>
          </div>

          <div className="space-y-1.5">
            {cardMode === 'session' && sessionTopSets.length > 0 ? (
              sessionTopSets.map((item, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border-2 border-[#1d1a16] shadow-[2px_2px_0_#1d1a16] ${
                    item.hasPr ? 'bg-[#cde6c0]' : 'bg-[#ece2c6]/65'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-marker text-sm bg-[#fbf5e4] px-2 py-0.5 rounded border border-[#1d1a16]">
                      #{i + 1}
                    </span>
                    <div className="truncate">
                      <span className="font-bold text-base text-[#1d1a16]">
                        {item.exerciseName}
                      </span>
                      <span className="text-xs font-bold text-[#5d5446] ml-2">
                        ({item.setsCount} sets)
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-marker text-sm sm:text-base text-[#1d1a16]">
                      {item.bestWeightKg}kg × {item.bestReps}
                    </span>
                    <span className="pill green !text-xs !py-0.5 !px-2">
                      e1RM {item.bestE1rmKg.toFixed(1)}kg
                      {item.hasPr ? ' 🏆' : ''}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              recentPrs.slice(0, 4).map((pr, i) => (
                <div
                  key={pr.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border-2 border-[#1d1a16] bg-[#cde6c0] shadow-[2px_2px_0_#1d1a16]"
                >
                  <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-[#d9412b]" />
                    <span className="font-bold text-base text-[#1d1a16]">
                      #{i + 1} {pr.exerciseName}
                    </span>
                  </div>
                  <span className="font-marker text-sm sm:text-base text-[#1d1a16]">
                    {pr.weightKg}kg × {pr.reps} (e1RM {pr.e1rmKg.toFixed(1)}kg)
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* MAV Muscle Badges Strip */}
        <div className="pt-2 border-t-2 border-dashed border-[#1d1a16] flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[#5d5446] mr-1">MAV Optimal Zone:</span>
            {mavMuscles.length > 0 ? (
              mavMuscles.slice(0, 7).map((m) => (
                <span
                  key={m}
                  className="bg-[#cde6c0] px-2 py-0.5 rounded border border-[#1d1a16] text-[#1d1a16]"
                >
                  ✔ {m}
                </span>
              ))
            ) : (
              <span className="text-[#5d5446]">Building weekly sets</span>
            )}
          </div>
          <span className="font-marker text-[#d9412b]">LIFT.0XPUDDU.COM</span>
        </div>
      </div>

      {/* Action Buttons: Download PNG Canvas + Copy Text Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={handleDownloadPng}
          disabled={downloading}
          className="btn big w-full"
        >
          <Download className="w-5 h-5" />
          {downloading ? 'RENDERING PNG CARD...' : 'DOWNLOAD PNG TRADING CARD'}
        </button>

        <button
          type="button"
          onClick={handleCopyText}
          className="btn big green w-full"
        >
          {copied ? (
            <>
              <Check className="w-5 h-5 text-[#2e7d3a]" />
              COPIED TO CLIPBOARD!
            </>
          ) : (
            <>
              <Copy className="w-5 h-5" />
              COPY TEXT SUMMARY
            </>
          )}
        </button>
      </div>
    </section>
  );
}
