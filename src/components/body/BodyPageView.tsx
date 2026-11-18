'use client';

import React, { useEffect, useState } from 'react';
import { Camera, Scale } from 'lucide-react';
import { apiFetch } from '@/components/ui';
import type { UserProfile } from '@/types/domain';
import { BodyWeightView } from './BodyWeightView';
import { ProgressPhotosView } from './ProgressPhotosView';

type BodyTab = 'weight' | 'photos';

export function BodyPageView() {
  const [tab, setTab] = useState<BodyTab>('weight');
  const [isGuest, setIsGuest] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const requestedPhotos = params.get('tab') === 'photos';

    apiFetch<{ user: UserProfile }>('/api/auth/me')
      .then((res) => {
        if (!active) return;
        const guest = Boolean(res.user?.isGuest);
        setIsGuest(guest);
        if (!guest && requestedPhotos) {
          setTab('photos');
        }
      })
      .catch(() => {
        // Auth errors are handled by BodyWeightView
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-6 pt-2">
      {!isGuest && (
        <div
          className="grid grid-cols-2 gap-2"
          role="tablist"
          aria-label="Body section"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'weight'}
            onClick={() => setTab('weight')}
            className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border-2 border-[var(--line)] px-3 text-sm font-bold transition ${
              tab === 'weight'
                ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)] shadow-[2px_2px_0_var(--shadow-color)]'
                : 'bg-[var(--card)] text-[var(--muted)]'
            }`}
          >
            <Scale className="h-4 w-4" aria-hidden="true" />
            Weight
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'photos'}
            onClick={() => setTab('photos')}
            className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border-2 border-[var(--line)] px-3 text-sm font-bold transition ${
              tab === 'photos'
                ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)] shadow-[2px_2px_0_var(--shadow-color)]'
                : 'bg-[var(--card)] text-[var(--muted)]'
            }`}
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            Photos
          </button>
        </div>
      )}

      {tab === 'photos' && !isGuest ? (
        <ProgressPhotosView />
      ) : (
        <BodyWeightView />
      )}
    </div>
  );
}
