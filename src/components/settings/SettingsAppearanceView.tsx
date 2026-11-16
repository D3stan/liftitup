'use client';

import React from 'react';
import { ThemeSelector } from '@/components/settings/ThemeSelector';
import { SettingsSubpageShell } from './SettingsSubpageShell';
import { useSettingsData } from './useSettingsData';

export function SettingsAppearanceView() {
  const { user, setUser, loading } = useSettingsData();

  return (
    <SettingsSubpageShell title="Appearance" user={user} loading={loading}>
      {user && (
        <ThemeSelector
          theme={user.theme}
          themeVariant={user.themeVariant}
          onUserUpdated={setUser}
        />
      )}
    </SettingsSubpageShell>
  );
}
