'use client';

import React from 'react';
import { Dumbbell, Calendar, BarChart3, Cpu } from 'lucide-react';

export type AppTab = 'workout' | 'schedule' | 'dashboard' | 'integrations';

interface BottomTabBarProps {
  activeTab: AppTab;
  onChangeTab: (tab: AppTab) => void;
  hasActiveWorkout?: boolean;
}

const TABS: {
  id: AppTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'workout', label: 'Train', icon: Dumbbell },
  { id: 'schedule', label: 'Split', icon: Calendar },
  { id: 'dashboard', label: 'Progress', icon: BarChart3 },
  { id: 'integrations', label: 'AI & Sync', icon: Cpu },
];

export default function BottomTabBar({
  activeTab,
  onChangeTab,
  hasActiveWorkout,
}: BottomTabBarProps) {
  return (
    <nav
      aria-label="Primary bottom navigation"
      className="fixed bottom-0 left-0 right-0 z-40 border-t-[3px] border-[#1d1a16] bg-[#ece2c6]/95 backdrop-blur-md px-2 pt-1.5"
      style={{ paddingBottom: 'calc(8px + var(--sab))' }}
    >
      <div className="mx-auto max-w-2xl grid grid-cols-4 gap-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeTab(tab.id)}
              className={`relative flex flex-col items-center justify-center min-h-[50px] rounded-[8px] border-[2.5px] transition-transform duration-100 ${
                isActive
                  ? 'bg-[#f2b632] border-[#1d1a16] shadow-[3px_3px_0_#1d1a16] -translate-y-0.5 font-bold text-[#1d1a16]'
                  : 'bg-[#fbf5e4]/80 border-transparent text-[#5d5446]'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs leading-tight mt-0.5 font-marker tracking-wide">
                {tab.label}
              </span>
              {tab.id === 'workout' && hasActiveWorkout && (
                <span
                  className="absolute top-1 right-2 w-2.5 h-2.5 rounded-full bg-[#2e7d3a] border border-[#1d1a16]"
                  title="Today's workout ready"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
