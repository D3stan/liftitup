'use client';

import React from 'react';
import { AiImportView } from '@/components/ai/AiImportView';
import { SettingsSubpageShell } from './SettingsSubpageShell';
import { useSettingsData } from './useSettingsData';

export function SettingsDataAiView() {
  const { user, loading } = useSettingsData();

  return (
    <SettingsSubpageShell
      title="AI Import"
      user={user}
      loading={loading}
      backHref="/settings/data"
      backLabel="Data"
    >
      {user && <AiImportView hideHeader />}
    </SettingsSubpageShell>
  );
}
