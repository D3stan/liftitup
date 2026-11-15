'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sparkles, UserCheck, UserPlus } from 'lucide-react';
import { apiFetch, Button, toast } from '@/components/ui';
import type { UserProfile } from '@/types/domain';

type AuthMode = 'login' | 'register';

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function WelcomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode: AuthMode =
    searchParams.get('mode') === 'register' ? 'register' : 'login';

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState<'submit' | 'guest' | null>(null);

  useEffect(() => {
    if (searchParams.get('mode') === 'register') {
      setMode('register');
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy('submit');
    try {
      const timezone = getBrowserTimezone();
      if (mode === 'login') {
        await apiFetch<{ user: UserProfile }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        });
        window.dispatchEvent(new Event('liftitup:user-updated'));
        router.replace('/');
      } else {
        await apiFetch<{ user: UserProfile }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username,
            password,
            displayName: displayName.trim() || undefined,
            timezone,
          }),
        });
        window.dispatchEvent(new Event('liftitup:user-updated'));
        router.replace('/onboarding');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleGuest() {
    if (busy) return;
    setBusy('guest');
    try {
      const timezone = getBrowserTimezone();
      await apiFetch<{ user: UserProfile }>('/api/auth/guest', {
        method: 'POST',
        body: JSON.stringify({ timezone }),
      });
      window.dispatchEvent(new Event('liftitup:user-updated'));
      router.replace('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start sample');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center">
          <h1 className="brand text-4xl">LIFTITUP</h1>
        </div>

        <div className="card space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={mode === 'login' ? 'primary' : 'alt'}
              onClick={() => setMode('login')}
              disabled={busy !== null}
            >
              <UserCheck className="h-4 w-4" />
              Log in
            </Button>
            <Button
              variant={mode === 'register' ? 'primary' : 'alt'}
              onClick={() => setMode('register')}
              disabled={busy !== null}
            >
              <UserPlus className="h-4 w-4" />
              Register
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label
                htmlFor="auth-username"
                className="mb-1 block text-sm font-bold text-[#5d5446]"
              >
                Username
              </label>
              <input
                id="auth-username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                required
                minLength={3}
                maxLength={32}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                className="nb-input"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label
                  htmlFor="auth-displayname"
                  className="mb-1 block text-sm font-bold text-[#5d5446]"
                >
                  Name (optional)
                </label>
                <input
                  id="auth-displayname"
                  type="text"
                  autoComplete="name"
                  maxLength={60}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="nb-input"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="auth-password"
                className="mb-1 block text-sm font-bold text-[#5d5446]"
              >
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                required
                minLength={mode === 'register' ? 8 : 1}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? '8+ characters' : 'password'}
                className="nb-input"
              />
            </div>

            <Button
              type="submit"
              size="big"
              className="w-full"
              loading={busy === 'submit'}
              disabled={busy !== null}
            >
              {busy === 'submit'
                ? 'Loading…'
                : mode === 'login'
                  ? 'Log in'
                  : 'Create account'}
            </Button>
          </form>
        </div>

        <Button
          variant="blue"
          size="big"
          className="w-full"
          onClick={handleGuest}
          loading={busy === 'guest'}
          disabled={busy !== null}
        >
          <Sparkles className="h-5 w-5" />
          {busy === 'guest' ? 'Loading…' : 'Explore as sample user'}
        </Button>
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center">
          <span className="font-marker text-xl">LIFTITUP</span>
        </div>
      }
    >
      <WelcomeContent />
    </Suspense>
  );
}
