'use client';

import React from 'react';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import type { UserProfile } from '@/types/domain';

interface AppHeaderProps {
  user: UserProfile | null;
}

export function AppHeader({ user }: AppHeaderProps) {
  return (
    <header
      className="sticky top-0 z-30 border-b-[3px] border-[var(--line)] bg-[var(--paper)]/95 backdrop-blur-md"
      style={{ paddingTop: 'var(--sat)' }}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link
            href="/"
            className="brand text-xl tracking-wide no-underline shrink-0"
          >
            LIFTITUP
          </Link>
          {user?.isGuest && (
            <Link
              href="/welcome?mode=register"
              className="pill gold text-xs no-underline min-h-[34px] shrink-0"
            >
              SAMPLE · Sign up
            </Link>
          )}
        </div>

        <Link
          href="/settings"
          aria-label="Settings"
          className="btn alt icon shrink-0"
        >
          <Settings className="h-5 w-5" />
        </Link>
      </div>
    </header>
  );
}
