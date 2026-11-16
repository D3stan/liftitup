'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ChevronRight,
  Database,
  Dumbbell,
  KeyRound,
  LogOut,
  Palette,
  Search,
  User,
  Watch,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui';
import {
  filterSettingsItems,
  getVisibleSettingsCategories,
  type SettingsCategoryId,
} from '@/lib/settings/registry';
import { useSettingsData } from './useSettingsData';

const CATEGORY_ICONS: Record<SettingsCategoryId, React.ReactNode> = {
  profile: <User className="h-5 w-5" />,
  appearance: <Palette className="h-5 w-5" />,
  training: <Dumbbell className="h-5 w-5" />,
  data: <Database className="h-5 w-5" />,
  'apple-health': <Watch className="h-5 w-5" />,
  integrations: <KeyRound className="h-5 w-5" />,
  danger: <AlertTriangle className="h-5 w-5 text-[var(--red)]" />,
};

export function SettingsIndexView() {
  const { user, loading, loggingOut, handleLogout } = useSettingsData();
  const [searchQuery, setSearchQuery] = useState('');

  const isGuest = Boolean(user?.isGuest);
  const trimmedQuery = searchQuery.trim();

  const visibleCategories = useMemo(
    () => getVisibleSettingsCategories({ isGuest }),
    [isGuest],
  );

  const searchResults = useMemo(() => {
    if (!trimmedQuery) return [];
    return filterSettingsItems(trimmedQuery, { isGuest });
  }, [trimmedQuery, isGuest]);

  if (loading || !user) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-28 pt-6">
        <h1 className="font-marker text-2xl text-[var(--ink)]">Settings</h1>
        <div className="card text-sm text-[var(--muted)]">
          {loading ? 'Loading…' : 'Unavailable'}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-28 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-marker text-2xl text-[var(--ink)]">Settings</h1>
        {user.isGuest && (
          <span className="rounded-lg border-2 border-[var(--line)] bg-[var(--gold)] px-2.5 py-0.5 text-xs font-bold text-[var(--btn-gold-fg)]">
            SAMPLE
          </span>
        )}
      </div>

      {/* Search */}
      <div className="relative flex items-center">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--muted)]"
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search settings (theme, export, delete…)"
          aria-label="Search settings"
          className="min-h-[44px] w-full rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] py-2 pl-9 pr-11 text-base"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
            className="absolute right-1 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {trimmedQuery ? (
        <section
          aria-label="Search results"
          className="flex flex-col gap-2.5"
        >
          {searchResults.length === 0 ? (
            <div className="card text-sm text-[var(--muted)]">
              No settings match &ldquo;{trimmedQuery}&rdquo;.
            </div>
          ) : (
            searchResults.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="card-sm flex min-h-[44px] items-center justify-between gap-3 no-underline transition hover:bg-[var(--surface-alt)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-marker text-base text-[var(--ink)]">
                      {item.title}
                    </span>
                    <span className="rounded-md border border-[var(--line)]/40 bg-[var(--surface-alt)] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                      {item.categoryTitle}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--muted)]">
                    {item.description}
                  </p>
                </div>
                <ChevronRight
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 text-[var(--muted)]"
                />
              </Link>
            ))
          )}
        </section>
      ) : (
        <nav aria-label="Settings categories" className="flex flex-col gap-2.5">
          {visibleCategories.map((cat) => {
            const isDanger = cat.id === 'danger';
            return (
              <Link
                key={cat.id}
                href={cat.href}
                className={`card-sm flex min-h-[56px] items-center justify-between gap-3 no-underline transition hover:bg-[var(--surface-alt)] ${
                  isDanger ? 'border-[var(--red)]' : ''
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-[var(--line)] ${
                      isDanger
                        ? 'bg-[var(--red-bg)] text-[var(--red)]'
                        : 'bg-[var(--surface)] text-[var(--ink)]'
                    }`}
                  >
                    {CATEGORY_ICONS[cat.id]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`font-marker text-lg leading-tight ${
                        isDanger ? 'text-[var(--red)]' : 'text-[var(--ink)]'
                      }`}
                    >
                      {cat.title}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-[var(--muted)]">
                      {cat.description}
                    </p>
                  </div>
                </div>
                <ChevronRight
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 text-[var(--muted)]"
                />
              </Link>
            );
          })}
        </nav>
      )}

      <Button
        variant="red"
        loading={loggingOut}
        onClick={handleLogout}
        className="mt-1 min-h-[44px] w-full justify-center gap-2"
      >
        <LogOut className="h-4 w-4" />
        Log out
      </Button>
    </div>
  );
}
