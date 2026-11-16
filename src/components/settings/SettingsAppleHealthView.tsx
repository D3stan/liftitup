'use client';

import React from 'react';
import { AppleFitnessPanel } from '@/components/integrations/AppleFitnessPanel';
import { SettingsSubpageShell } from './SettingsSubpageShell';
import { useSettingsData } from './useSettingsData';

export function SettingsAppleHealthView() {
  const { user, setUser, loading } = useSettingsData();

  return (
    <SettingsSubpageShell title="Apple Health" user={user} loading={loading}>
      {user && <AppleFitnessPanel user={user} onUserUpdated={setUser} />}
    </SettingsSubpageShell>
  );
}
