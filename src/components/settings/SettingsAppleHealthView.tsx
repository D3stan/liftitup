'use client';

import React from 'react';
import { AppleFitnessPanel } from '@/components/integrations/AppleFitnessPanel';
import { SettingsSubpageShell } from './SettingsSubpageShell';
import { useSettingsData } from './useSettingsData';

interface SettingsAppleHealthViewProps {
  shortcutUrl?: string | null;
}

export function SettingsAppleHealthView({
  shortcutUrl = null,
}: SettingsAppleHealthViewProps) {
  const { user, setUser, loading } = useSettingsData();

  return (
    <SettingsSubpageShell title="Apple Health" user={user} loading={loading}>
      {user && (
        <AppleFitnessPanel
          user={user}
          shortcutUrl={shortcutUrl}
          onUserUpdated={setUser}
        />
      )}
    </SettingsSubpageShell>
  );
}
