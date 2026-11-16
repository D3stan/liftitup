'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Download, Trash2 } from 'lucide-react';
import { Button, Sheet, apiFetch, toast } from '@/components/ui';
import { clearAllUserDrafts } from '@/lib/offline/outbox';
import {
  DANGER_ACTIONS,
  type DangerAction,
  type DangerActionMeta,
} from '@/lib/settings/danger';
import type { UserProfile } from '@/types/domain';
import { SettingsSubpageShell } from './SettingsSubpageShell';
import { useSettingsData } from './useSettingsData';

const ACTION_ANCHOR_ID: Record<DangerAction, string> = {
  delete_workouts: 'delete-workouts',
  delete_body: 'delete-body',
  reset_split: 'reset-split',
  delete_account: 'delete-account',
};

interface DangerActionResponse {
  ok: boolean;
  action: DangerAction;
  user?: UserProfile | null;
}

export function SettingsDangerView() {
  const router = useRouter();
  const { user, setUser, loading } = useSettingsData();
  const [selectedAction, setSelectedAction] = useState<DangerActionMeta | null>(
    null,
  );
  const [confirmInput, setConfirmInput] = useState('');
  const [busy, setBusy] = useState(false);

  function openConfirmation(action: DangerActionMeta) {
    setSelectedAction(action);
    setConfirmInput('');
  }

  function closeConfirmation() {
    if (busy) return;
    setSelectedAction(null);
    setConfirmInput('');
  }

  const isConfirmed =
    selectedAction !== null &&
    confirmInput.trim().toUpperCase() === selectedAction.confirmationWord;

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !selectedAction || !isConfirmed || busy) return;

    setBusy(true);
    try {
      const res = await apiFetch<DangerActionResponse>('/api/settings/danger', {
        method: 'POST',
        body: JSON.stringify({
          action: selectedAction.id,
          confirmation: confirmInput.trim(),
        }),
      });

      if (selectedAction.id === 'delete_workouts') {
        clearAllUserDrafts(user.id);
        toast.success('All workout history deleted');
      } else if (selectedAction.id === 'delete_body') {
        if (res.user) {
          setUser(res.user);
          window.dispatchEvent(new Event('liftitup:user-updated'));
        }
        toast.success('All body data deleted');
      } else if (selectedAction.id === 'reset_split') {
        toast.success('Split reset');
      } else if (selectedAction.id === 'delete_account') {
        clearAllUserDrafts(user.id);
        toast.success('Account deleted');
        setSelectedAction(null);
        router.replace('/welcome');
        return;
      }

      setSelectedAction(null);
      setConfirmInput('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSubpageShell title="Danger zone" user={user} loading={loading}>
      {user && user.isGuest && (
        <section className="card flex flex-col gap-3">
          <p className="text-sm text-[var(--muted)]">
            Danger zone actions are not available for guest sample accounts.
          </p>
          <Link
            href="/settings"
            className="btn alt min-h-[44px] justify-center no-underline"
          >
            Back to Settings
          </Link>
        </section>
      )}

      {user && !user.isGuest && (
        <>
          <div className="card-sm flex items-start gap-2.5 border-[var(--red)] bg-[var(--red-bg)]">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--red)]" />
            <p className="text-sm text-[var(--ink)]">
              These actions are permanent and have no undo. Download a JSON export
              before proceeding.
            </p>
          </div>

          {DANGER_ACTIONS.map((action) => (
            <section
              key={action.id}
              id={ACTION_ANCHOR_ID[action.id]}
              className="card flex flex-col gap-3 border-[var(--red)]"
            >
              <div>
                <h2 className="font-marker text-lg text-[var(--red)]">
                  {action.title}
                </h2>
                <p className="mt-0.5 text-sm text-[var(--muted)]">
                  {action.description}
                </p>
              </div>

              <div className="flex flex-col gap-1.5 rounded-xl border-2 border-[var(--line)]/30 bg-[var(--surface)] p-3 text-sm">
                <div>
                  <span className="font-bold text-[var(--red)]">Removes: </span>
                  <span className="text-[var(--ink)]">{action.removes}</span>
                </div>
                <div>
                  <span className="font-bold text-[var(--ink)]">Keeps: </span>
                  <span className="text-[var(--muted)]">{action.keeps}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <a
                  href="/api/export?format=json"
                  download
                  className="btn alt min-h-[44px] flex-1 justify-center gap-2 no-underline"
                >
                  <Download className="h-4 w-4" />
                  Export JSON first
                </a>
                <Button
                  variant="red"
                  onClick={() => openConfirmation(action)}
                  className="min-h-[44px] flex-1 justify-center gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  {action.buttonLabel}
                </Button>
              </div>
            </section>
          ))}

          <Sheet
            open={selectedAction !== null}
            onClose={closeConfirmation}
            title={selectedAction?.title}
          >
            {selectedAction && (
              <form onSubmit={handleConfirm} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5 rounded-xl border-2 border-[var(--line)]/40 bg-[var(--surface)] p-3 text-sm">
                  <div>
                    <span className="font-bold text-[var(--red)]">
                      Removes:{' '}
                    </span>
                    <span className="text-[var(--ink)]">
                      {selectedAction.removes}
                    </span>
                  </div>
                  <div>
                    <span className="font-bold text-[var(--ink)]">Keeps: </span>
                    <span className="text-[var(--muted)]">
                      {selectedAction.keeps}
                    </span>
                  </div>
                </div>

                <a
                  href="/api/export?format=json"
                  download
                  className="btn alt min-h-[44px] w-full justify-center gap-2 no-underline"
                >
                  <Download className="h-4 w-4" />
                  Download JSON export first
                </a>

                <label className="flex flex-col gap-1">
                  <span className="text-sm font-bold text-[var(--ink)]">
                    Type{' '}
                    <code className="rounded bg-[var(--surface-alt)] px-1.5 py-0.5 font-mono">
                      {selectedAction.confirmationWord}
                    </code>{' '}
                    to confirm
                  </span>
                  <input
                    type="text"
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    placeholder={selectedAction.confirmationWord}
                    autoComplete="off"
                    autoCapitalize="characters"
                    className="min-h-[44px] rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 text-base"
                  />
                </label>

                <div className="flex gap-2">
                  <Button
                    variant="alt"
                    onClick={closeConfirmation}
                    disabled={busy}
                    className="min-h-[44px] flex-1 justify-center"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="red"
                    loading={busy}
                    disabled={!isConfirmed}
                    className="min-h-[44px] flex-1 justify-center"
                  >
                    Confirm
                  </Button>
                </div>
              </form>
            )}
          </Sheet>
        </>
      )}
    </SettingsSubpageShell>
  );
}
