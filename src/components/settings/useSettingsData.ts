'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiFetch, toast } from '@/components/ui';
import { clearAllUserDrafts } from '@/lib/offline/outbox';
import type { ApiKeyInfo, UserProfile } from '@/types/domain';

export interface SettingsPayload {
  user: UserProfile;
  apiKey: ApiKeyInfo | null;
}

export function useSettingsData() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [apiKeyInfo, setApiKeyInfo] = useState<ApiKeyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<SettingsPayload>('/api/settings');
        if (cancelled) return;
        setUser(res.user);
        setApiKeyInfo(res.apiKey);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          router.replace('/welcome');
          return;
        }
        toast.error(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      if (user) {
        clearAllUserDrafts(user.id);
      }
      router.replace('/welcome');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Logout failed');
      setLoggingOut(false);
    }
  }, [loggingOut, router, user]);

  return {
    user,
    setUser,
    apiKeyInfo,
    setApiKeyInfo,
    loading,
    loggingOut,
    handleLogout,
  };
}
