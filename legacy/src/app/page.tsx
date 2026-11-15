'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type {
  UserProfile,
  PrecompiledSession,
  Schedule,
  AnalyticsSummary,
  ExerciseDefinition,
  SessionDebriefImpact,
} from '@/types/domain';
import TopHudBar from '@/components/shell/TopHudBar';
import BottomTabBar, { type AppTab } from '@/components/shell/BottomTabBar';
import ProfileAuthModal from '@/components/shell/ProfileAuthModal';
import WorkoutTabView from '@/components/workout/WorkoutTabView';
import DashboardTabView from '@/components/dashboard/DashboardTabView';
import IntegrationsTabView from '@/components/integrations/IntegrationsTabView';
import { RotateCcw } from 'lucide-react';

export default function LiftItUpAppShell() {
  const [activeTab, setActiveTab] = useState<AppTab>('workout');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [precompiledSession, setPrecompiledSession] =
    useState<PrecompiledSession | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [exercises, setExercises] = useState<ExerciseDefinition[]>([]);
  const [selectedDayOfWeek, setSelectedDayOfWeek] = useState<number | null>(
    null
  );
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [toast, setToast] = useState<{
    message: string;
    undoAction?: () => Promise<void>;
  } | null>(null);

  const showToast = useCallback(
    (message: string, undoAction?: () => Promise<void>) => {
      setToast({ message, undoAction });
    },
    []
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadAllData = useCallback(
    async (overrideDayOfWeek?: number | null) => {
      try {
        const dayParam =
          overrideDayOfWeek !== undefined && overrideDayOfWeek !== null
            ? `?dayOfWeek=${overrideDayOfWeek}`
            : selectedDayOfWeek !== null
            ? `?dayOfWeek=${selectedDayOfWeek}`
            : '';

        const [authRes, precompileRes, scheduleRes, analyticsRes] =
          await Promise.all([
            fetch('/api/auth'),
            fetch(`/api/workouts/precompile${dayParam}`),
            fetch('/api/schedule'),
            fetch('/api/analytics'),
          ]);

        if (authRes.ok) {
          const authData = await authRes.json();
          if (authData.user) setUser(authData.user);
        }
        if (precompileRes.ok) {
          const preData = await precompileRes.json();
          if (preData.session) setPrecompiledSession(preData.session);
          if (preData.exercises) setExercises(preData.exercises);
        }
        if (scheduleRes.ok) {
          const schedData = await scheduleRes.json();
          if (schedData.schedule) setSchedule(schedData.schedule);
          if (schedData.exercises && exercises.length === 0) {
            setExercises(schedData.exercises);
          }
        }
        if (analyticsRes.ok) {
          const anaData = await analyticsRes.json();
          if (anaData.analytics) {
            setAnalytics(anaData.analytics);
            if (anaData.analytics.user) setUser(anaData.analytics.user);
          }
        }
      } catch (err) {
        console.error('Failed to load LiftItUp state:', err);
      } finally {
        setLoading(false);
      }
    },
    [selectedDayOfWeek, exercises.length]
  );

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const handleSelectRoutineDay = async (dayOfWeek: number) => {
    setSelectedDayOfWeek(dayOfWeek);
    await loadAllData(dayOfWeek);
  };

  const handleSessionLogged = async (impact: SessionDebriefImpact) => {
    await loadAllData();
    showToast(
      `Workout logged! +${impact.xpEarned} XP (${impact.session.totalSets} sets)`
    );
  };

  if (loading && !user) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 text-center">
        <div className="hero-card max-w-sm w-full space-y-3">
          <div className="brand text-3xl justify-center">
            LIFT<span className="text-[#1d1a16]">IT</span>UP
          </div>
          <p className="font-bold text-lg">
            Loading your precompiled hypertrophy session & notebook...
          </p>
          <div className="bar">
            <div className="bar-fill gold" style={{ width: '65%' }} />
          </div>
        </div>
      </div>
    );
  }

  const activeUser: UserProfile = user || {
    id: 'demo-alex',
    username: 'alex',
    displayName: 'Alex (Hypertrophy Pro)',
    bodyweightKg: 78.5,
    unit: 'kg',
    xp: 14850,
    level: 14,
    rankTier: 'Gold',
    currentStreak: 12,
    bestStreak: 19,
    streakShields: 2,
    apiKey: 'liu_demo_alex_hypertrophy_key_2026',
    appleFitnessEnabled: true,
    createdAt: new Date().toISOString(),
  };

  return (
    <div className="min-h-[100dvh] flex flex-col pb-[calc(88px+var(--sab))]">
      <TopHudBar
        user={activeUser}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled((s) => !s)}
        onOpenProfileModal={() => setIsProfileModalOpen(true)}
      />

      <main className="flex-1 mx-auto w-full max-w-2xl px-3 pt-4 pb-8">
        {(activeTab === 'workout' || activeTab === 'schedule') && (
          <WorkoutTabView
            user={activeUser}
            precompiledSession={precompiledSession}
            schedule={schedule}
            exercises={exercises}
            recentSessions={analytics?.recentSessions || []}
            soundEnabled={soundEnabled}
            activeMode={activeTab === 'schedule' ? 'schedule' : 'workout'}
            onRefresh={() => loadAllData()}
            onSelectRoutineDay={handleSelectRoutineDay}
            onSessionLogged={handleSessionLogged}
            onScheduleUpdated={(updated) => {
              setSchedule(updated);
              loadAllData();
            }}
            onShowToast={showToast}
          />
        )}

        {activeTab === 'dashboard' && (
          <DashboardTabView
            user={activeUser}
            analytics={analytics}
            exercises={exercises}
            onRefresh={() => loadAllData()}
            onShowToast={(msg) => showToast(msg)}
          />
        )}

        {activeTab === 'integrations' && (
          <IntegrationsTabView
            user={activeUser}
            schedule={schedule}
            precompiledSession={precompiledSession}
            analytics={analytics}
            exercises={exercises}
            onRefresh={() => loadAllData()}
            onUserUpdated={(u) => setUser(u)}
            onShowToast={(msg) => showToast(msg)}
          />
        )}
      </main>

      {/* Signature Dark Ink Toast with 1-Tap Gold Undo (from myfood) */}
      {toast && (
        <div
          className="fixed left-3 right-3 z-50 mx-auto max-w-md bg-[#1d1a16] text-[#fbf5e4] border-[3px] border-[#1d1a16] rounded-[10px] px-4 py-2.5 flex items-center justify-between gap-3"
          style={{
            bottom: 'calc(78px + var(--sab))',
            boxShadow: '4px 4px 0 var(--gold)',
          }}
        >
          <span className="text-base font-bold">{toast.message}</span>
          {toast.undoAction && (
            <button
              type="button"
              onClick={async () => {
                const fn = toast.undoAction;
                setToast(null);
                if (fn) await fn();
              }}
              className="btn !min-h-[36px] !px-3 !py-1 text-sm shrink-0"
            >
              <RotateCcw className="w-4 h-4" />
              Undo
            </button>
          )}
        </div>
      )}

      <ProfileAuthModal
        isOpen={isProfileModalOpen}
        currentUser={activeUser}
        onClose={() => setIsProfileModalOpen(false)}
        onUserSwitched={(newUser) => {
          setUser(newUser);
          loadAllData();
        }}
        onShowToast={(msg) => showToast(msg)}
      />

      <BottomTabBar
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        hasActiveWorkout={Boolean(
          precompiledSession && !precompiledSession.isRestDay
        )}
      />
    </div>
  );
}
