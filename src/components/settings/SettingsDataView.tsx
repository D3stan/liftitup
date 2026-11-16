'use client';

import React from 'react';
import { Download } from 'lucide-react';
import { SettingsSubpageShell } from './SettingsSubpageShell';
import { useSettingsData } from './useSettingsData';

export function SettingsDataView() {
  const { user, loading } = useSettingsData();

  return (
    <SettingsSubpageShell title="Data" user={user} loading={loading}>
      {user && (
        <section className="card flex flex-col gap-3">
          <div>
            <h2 className="font-marker text-lg text-[var(--ink)]">Export</h2>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              Download your workout sessions, active split, custom exercises, and body metrics.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <a
              href="/api/export?format=json"
              download
              className="btn alt min-h-[44px] justify-center gap-2 no-underline"
            >
              <Download className="h-4 w-4" />
              JSON
            </a>
            <a
              href="/api/export?format=csv"
              download
              className="btn alt min-h-[44px] justify-center gap-2 no-underline"
            >
              <Download className="h-4 w-4" />
              CSV
            </a>
          </div>
        </section>
      )}
    </SettingsSubpageShell>
  );
}
