'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { UserProfile } from '@/types/domain';
import { applyThemeToDocument } from '@/lib/theme';
import { ApiClientError, apiFetch, Toaster } from '@/components/ui';
import { AppHeader } from './AppHeader';
import { BottomNav } from './BottomNav';

const SHELL_LESS_PREFIXES = ['/welcome', '/onboarding'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);

  const isShellLess = SHELL_LESS_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
  const isWelcome = pathname.startsWith('/welcome');

  const loadMe = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: UserProfile }>('/api/auth/me');
      setUser(data.user);
      applyThemeToDocument(data.user.theme, data.user.themeVariant);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setUser(null);
        router.replace('/welcome');
      }
    }
  }, [router]);

  useEffect(() => {
    if (isWelcome) {
      setUser(null);
      return;
    }
    void loadMe();
  }, [isWelcome, pathname, loadMe]);

  useEffect(() => {
    const onUserChanged = () => {
      if (!isWelcome) {
        void loadMe();
      }
    };
    window.addEventListener('liftitup:user-updated', onUserChanged);
    return () => {
      window.removeEventListener('liftitup:user-updated', onUserChanged);
    };
  }, [isWelcome, loadMe]);

  if (isShellLess) {
    return (
      <>
        {children}
        <Toaster />
      </>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-3 pt-3 pb-[calc(var(--tabbar)+var(--sab)+24px)]">
        {children}
      </main>
      <BottomNav />
      <Toaster />
    </div>
  );
}
