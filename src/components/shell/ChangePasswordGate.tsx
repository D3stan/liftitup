'use client';

import React, { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { apiFetch, Button, toast } from '@/components/ui';
import type { UserProfile } from '@/types/domain';

interface ChangePasswordGateProps {
  user: UserProfile;
  onPasswordChanged: (user: UserProfile) => void;
  onLogout?: () => Promise<void> | void;
}

export function ChangePasswordGate({
  user,
  onPasswordChanged,
  onLogout,
}: ChangePasswordGateProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (newPassword.length < 8 || newPassword.length > 128) {
      toast.error('New password must be between 8 and 128 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch<{ ok: true; user: UserProfile }>(
        '/api/auth/change-password',
        {
          method: 'POST',
          body: JSON.stringify({ newPassword }),
        },
      );
      toast.success('Password updated');
      onPasswordChanged(res.user);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update password',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoutClick() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      if (onLogout) {
        await onLogout();
      } else {
        window.location.href = '/welcome';
      }
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-[var(--paper)] px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <h1 className="brand text-3xl">LIFTITUP</h1>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-[var(--line)] bg-[var(--gold-bg)]">
              <KeyRound className="h-5 w-5 text-[var(--ink)]" />
            </span>
            <div>
              <h2 className="font-marker text-xl text-[var(--ink)]">
                Choose a New Password
              </h2>
              <p className="mt-0.5 text-sm text-[var(--muted)]">
                Your password for <strong>@{user.username}</strong> was reset
                with a temporary password. Set a new password before continuing.
              </p>
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              New password
            </span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="8+ characters"
              className="nb-input"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              Confirm new password
            </span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
              className="nb-input"
            />
          </label>

          <Button
            type="submit"
            size="big"
            loading={saving}
            className="w-full"
          >
            Save New Password
          </Button>

          <Button
            type="button"
            variant="alt"
            loading={loggingOut}
            onClick={handleLogoutClick}
            className="w-full justify-center gap-2"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </Button>
        </form>
      </div>
    </div>
  );
}
