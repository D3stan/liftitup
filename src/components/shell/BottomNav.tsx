'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarDays,
  Cpu,
  Dumbbell,
  Layers,
  TrendingUp,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: 'Calendar',
    icon: CalendarDays,
    match: (p) => p === '/' || p.startsWith('/workout'),
  },
  {
    href: '/split',
    label: 'Split',
    icon: Layers,
    match: (p) => p.startsWith('/split'),
  },
  {
    href: '/exercises',
    label: 'Exercises',
    icon: Dumbbell,
    match: (p) => p.startsWith('/exercises'),
  },
  {
    href: '/progress',
    label: 'Progress',
    icon: TrendingUp,
    match: (p) => p.startsWith('/progress'),
  },
  {
    href: '/ai',
    label: 'AI',
    icon: Cpu,
    match: (p) => p.startsWith('/ai'),
  },
];

export function BottomNav() {
  const pathname = usePathname() || '/';

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 left-0 right-0 z-40 border-t-[3px] border-[#1d1a16] bg-[#ece2c6]/95 backdrop-blur-md px-1.5 pt-1.5"
      style={{ paddingBottom: 'calc(8px + var(--sab))' }}
    >
      <div className="mx-auto grid max-w-2xl grid-cols-5 gap-1.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[48px] flex-col items-center justify-center rounded-[8px] border-[2.5px] px-1 py-1 no-underline transition-transform duration-100 ${
                active
                  ? 'bg-[#f2b632] border-[#1d1a16] shadow-[3px_3px_0_#1d1a16] -translate-y-0.5 text-[#1d1a16] font-bold'
                  : 'bg-[#fbf5e4]/80 border-transparent text-[#5d5446]'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="mt-0.5 font-marker text-[11px] leading-tight tracking-wide">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
