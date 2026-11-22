import React from 'react';
import { SettingsAppleHealthView } from '@/components/settings/SettingsAppleHealthView';
import { getConfiguredAppleHealthShortcutUrl } from '@/lib/integrations/appleHealthShortcutConfig';

export const dynamic = 'force-dynamic';

export default function SettingsAppleHealthPage() {
  const shortcutUrl = getConfiguredAppleHealthShortcutUrl();
  return <SettingsAppleHealthView shortcutUrl={shortcutUrl} />;
}
