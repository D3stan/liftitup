export type SettingsCategoryId =
  | 'profile'
  | 'appearance'
  | 'training'
  | 'data'
  | 'apple-health'
  | 'integrations'
  | 'danger';

export interface SettingsCategoryMeta {
  id: SettingsCategoryId;
  title: string;
  description: string;
  href: string;
  hideForGuest?: boolean;
}

export interface SettingsSearchItem {
  id: string;
  title: string;
  description: string;
  categoryId: SettingsCategoryId;
  categoryTitle: string;
  href: string;
  keywords: string[];
  hideForGuest?: boolean;
}

export const SETTINGS_CATEGORIES: SettingsCategoryMeta[] = [
  {
    id: 'profile',
    title: 'Profile',
    description: 'Name, body weight, height, age, unit, and timezone.',
    href: '/settings/profile',
  },
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'App theme and light or dark notebook variant.',
    href: '/settings/appearance',
  },
  {
    id: 'training',
    title: 'Training',
    description: 'Workout logging options such as execution quality.',
    href: '/settings/training',
  },
  {
    id: 'data',
    title: 'Data',
    description: 'Export your workouts and body metrics as JSON or CSV.',
    href: '/settings/data',
  },
  {
    id: 'apple-health',
    title: 'Apple Health',
    description: 'Toggle Apple Health sync, copy webhook URL, or import files.',
    href: '/settings/apple-health',
  },
  {
    id: 'integrations',
    title: 'Integrations',
    description: 'MCP server endpoint, API key, and client configuration.',
    href: '/settings/integrations',
  },
  {
    id: 'danger',
    title: 'Danger zone',
    description: 'Delete workout history, body data, split, or your account.',
    href: '/settings/danger',
    hideForGuest: true,
  },
];

export const SETTINGS_SEARCH_ITEMS: SettingsSearchItem[] = [
  // Profile
  {
    id: 'profile-name',
    title: 'Display Name',
    description: 'Your name shown in the app.',
    categoryId: 'profile',
    categoryTitle: 'Profile',
    href: '/settings/profile',
    keywords: ['name', 'display name', 'profile', 'account'],
  },
  {
    id: 'profile-weight',
    title: 'Body Weight',
    description: 'Current weight used for bodyweight exercises.',
    categoryId: 'profile',
    categoryTitle: 'Profile',
    href: '/settings/profile',
    keywords: ['weight', 'body weight', 'kg', 'lb', 'profile'],
  },
  {
    id: 'profile-height',
    title: 'Height',
    description: 'Your height in centimetres.',
    categoryId: 'profile',
    categoryTitle: 'Profile',
    href: '/settings/profile',
    keywords: ['height', 'cm', 'profile'],
  },
  {
    id: 'profile-age',
    title: 'Age',
    description: 'Your age in years.',
    categoryId: 'profile',
    categoryTitle: 'Profile',
    href: '/settings/profile',
    keywords: ['age', 'profile'],
  },
  {
    id: 'profile-training-years',
    title: 'Training Years',
    description: 'Years of lifting experience.',
    categoryId: 'profile',
    categoryTitle: 'Profile',
    href: '/settings/profile',
    keywords: ['training years', 'experience', 'profile'],
  },
  {
    id: 'profile-unit',
    title: 'Weight Unit (kg / lb)',
    description: 'Choose kilograms or pounds for display.',
    categoryId: 'profile',
    categoryTitle: 'Profile',
    href: '/settings/profile',
    keywords: ['unit', 'kg', 'lb', 'kilograms', 'pounds', 'weight unit'],
  },
  {
    id: 'profile-timezone',
    title: 'Timezone',
    description: 'IANA timezone used for workout dates and schedule.',
    categoryId: 'profile',
    categoryTitle: 'Profile',
    href: '/settings/profile',
    keywords: ['timezone', 'tz', 'time', 'utc', 'auto'],
  },
  {
    id: 'profile-logout',
    title: 'Log out',
    description: 'Sign out of this device and clear local drafts.',
    categoryId: 'profile',
    categoryTitle: 'Profile',
    href: '/settings/profile',
    keywords: ['log out', 'logout', 'sign out', 'session'],
  },

  // Appearance
  {
    id: 'appearance-theme',
    title: 'Theme & Light/Dark Variant',
    description:
      'Switch between Notebook, Cutecore, Analog Horror, Phonk, Future Funk, and Lo-fi Art.',
    categoryId: 'appearance',
    categoryTitle: 'Appearance',
    href: '/settings/appearance',
    keywords: [
      'theme',
      'appearance',
      'dark',
      'light',
      'variant',
      'notebook',
      'cutecore',
      'analog horror',
      'brazilian phonk',
      'future funk',
      'lofi',
      'color',
    ],
  },

  // Training
  {
    id: 'training-execution-quality',
    title: 'Execution Quality %',
    description: 'Toggle execution quality tracking on sets and reps.',
    categoryId: 'training',
    categoryTitle: 'Training',
    href: '/settings/training',
    keywords: [
      'execution quality',
      'set quality',
      'rep quality',
      'quality',
      'percentage',
      'training',
    ],
  },

  // Data
  {
    id: 'data-export',
    title: 'Export Data (JSON & CSV)',
    description: 'Download all your workouts, split, and body metrics.',
    categoryId: 'data',
    categoryTitle: 'Data',
    href: '/settings/data',
    keywords: ['export', 'download', 'json', 'csv', 'backup', 'data'],
  },

  // Apple Health
  {
    id: 'apple-health-integration',
    title: 'Apple Health Sync & Import',
    description: 'Enable or pause sync, copy webhook URL, or import XML/JSON/CSV.',
    categoryId: 'apple-health',
    categoryTitle: 'Apple Health',
    href: '/settings/apple-health',
    keywords: [
      'apple health',
      'apple fitness',
      'watch',
      'webhook',
      'shortcut',
      'import',
      'xml',
      'heart rate',
      'calories',
    ],
  },

  // Integrations
  {
    id: 'integrations-mcp',
    title: 'MCP Endpoint & Client Config',
    description: 'Copy the MCP endpoint URL and client JSON configuration.',
    categoryId: 'integrations',
    categoryTitle: 'Integrations',
    href: '/settings/integrations',
    keywords: [
      'mcp',
      'endpoint',
      'client config',
      'model context protocol',
      'integrations',
      'agent',
    ],
  },
  {
    id: 'integrations-api-key',
    title: 'API Key',
    description: 'View key prefix or regenerate your personal API key.',
    categoryId: 'integrations',
    categoryTitle: 'Integrations',
    href: '/settings/integrations',
    keywords: ['api key', 'key', 'token', 'regenerate', 'bearer', 'integrations'],
  },

  // Danger zone (hidden for guests)
  {
    id: 'danger-delete-workouts',
    title: 'Delete All Workout History',
    description: 'Remove all logged sessions, sets, rep qualities, and swaps.',
    categoryId: 'danger',
    categoryTitle: 'Danger zone',
    href: '/settings/danger#delete-workouts',
    keywords: ['delete', 'workout', 'history', 'sessions', 'erase', 'danger'],
    hideForGuest: true,
  },
  {
    id: 'danger-delete-body',
    title: 'Delete All Body Data',
    description: 'Remove body metrics and reset profile weight to default.',
    categoryId: 'danger',
    categoryTitle: 'Danger zone',
    href: '/settings/danger#delete-body',
    keywords: ['delete', 'body', 'metrics', 'weight', 'erase', 'danger'],
    hideForGuest: true,
  },
  {
    id: 'danger-reset-split',
    title: 'Reset Split',
    description: 'Delete all schedules, days, and schedule events.',
    categoryId: 'danger',
    categoryTitle: 'Danger zone',
    href: '/settings/danger#reset-split',
    keywords: ['reset', 'split', 'schedule', 'delete', 'danger'],
    hideForGuest: true,
  },
  {
    id: 'danger-delete-account',
    title: 'Delete Account',
    description: 'Permanently delete your account and all associated data.',
    categoryId: 'danger',
    categoryTitle: 'Danger zone',
    href: '/settings/danger#delete-account',
    keywords: ['delete', 'account', 'erase', 'remove', 'danger'],
    hideForGuest: true,
  },
];

export function getVisibleSettingsCategories(options?: {
  isGuest?: boolean;
}): SettingsCategoryMeta[] {
  const isGuest = Boolean(options?.isGuest);
  return SETTINGS_CATEGORIES.filter((cat) => !(isGuest && cat.hideForGuest));
}

export function filterSettingsItems(
  rawQuery: string,
  options?: { isGuest?: boolean },
): SettingsSearchItem[] {
  const isGuest = Boolean(options?.isGuest);
  const visible = SETTINGS_SEARCH_ITEMS.filter(
    (item) => !(isGuest && item.hideForGuest),
  );

  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) {
    return visible;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  return visible.filter((item) => {
    const haystack = [
      item.title,
      item.description,
      item.categoryTitle,
      ...item.keywords,
    ]
      .join(' ')
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}
