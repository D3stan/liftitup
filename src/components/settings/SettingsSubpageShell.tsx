'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { UserProfile } from '@/types/domain';

interface SettingsSubpageShellProps {
  title: string;
  user: UserProfile | null;
  loading: boolean;
  children: React.ReactNode;
}

export function SettingsSubpageShell({
  title,
  user,
  loading,
  children,
}: SettingsSubpageShellProps) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-28 pt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href="/settings"
            className="btn alt min-h-[44px] shrink-0 gap-1.5 px-3 no-underline"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Settings</span>
          </Link>
          <h1 className="truncate font-marker text-2xl text-[var(--ink)]">
            {title}
          </h1>
        </div>
        {user?.isGuest && (
          <span className="shrink-0 rounded-lg border-2 border-[var(--line)] bg-[var(--gold)] px-2.5 py-0.5 text-xs font-bold text-[var(--btn-gold-fg)]">
            SAMPLE
          </span>
        )}
      </div>

      {loading || !user ? (
        <div className="card text-sm text-[var(--muted)]">
          {loading ? 'Loading…' : 'Unavailable'}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
