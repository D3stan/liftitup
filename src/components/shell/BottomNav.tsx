'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarDays,
  Dumbbell,
  Layers,
  Scale,
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
    href: '/body',
    label: 'Body',
    icon: Scale,
    match: (p) => p.startsWith('/body'),
  },
];

export function BottomNav() {
  const pathname = usePathname() || '/';

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 left-0 right-0 z-40 border-t-[3px] border-[var(--line)] bg-[var(--paper)]/95 backdrop-blur-md px-1.5 pt-1.5"
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
                  ? 'bg-[var(--gold)] border-[var(--line)] shadow-[3px_3px_0_var(--shadow-color)] -translate-y-0.5 text-[var(--btn-gold-fg)] font-bold'
                  : 'bg-[var(--card)]/80 border-transparent text-[var(--muted)]'
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
