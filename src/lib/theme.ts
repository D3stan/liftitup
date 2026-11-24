import type { AppTheme, ThemeVariant } from '@/types/domain';

export type { AppTheme, ThemeVariant };

export const DEFAULT_THEME: AppTheme = 'notebook';
export const DEFAULT_THEME_VARIANT: ThemeVariant = 'light';

export const THEME_STORAGE_KEY = 'liftitup:theme';
export const THEME_VARIANT_STORAGE_KEY = 'liftitup:themeVariant';

export interface ThemeMeta {
  id: AppTheme;
  name: string;
  subtitle: string;
  supportsVariants: boolean;
}

export const APP_THEMES: readonly ThemeMeta[] = [
  {
    id: 'notebook',
    name: 'Notebook',
    subtitle: 'Ink & paper sketch',
    supportsVariants: true,
  },
  {
    id: 'cutecore',
    name: 'Cutecore',
    subtitle: 'Hello Kitty pixel pastel',
    supportsVariants: false,
  },
  {
    id: 'analog-horror',
    name: 'Analog Horror',
    subtitle: 'CRT & VHS broadcast',
    supportsVariants: false,
  },
  {
    id: 'brazilian-phonk',
    name: 'Brazilian Phonk',
    subtitle: 'Acid neon & street drift',
    supportsVariants: false,
  },
  {
    id: 'future-funk',
    name: 'Future Funk',
    subtitle: '80s city-pop & synth neon',
    supportsVariants: false,
  },
  {
    id: 'lofi-art',
    name: 'Lo-fi Art',
    subtitle: 'Rainy twilight & warm lamp',
    supportsVariants: false,
  },
  {
    id: 'frutiger-aero',
    name: 'Frutiger Aero',
    subtitle: 'Glossy aqua & sunlit glass',
    supportsVariants: false,
  },
] as const;

export function isValidAppTheme(val: unknown): val is AppTheme {
  return (
    val === 'notebook' ||
    val === 'cutecore' ||
    val === 'analog-horror' ||
    val === 'brazilian-phonk' ||
    val === 'future-funk' ||
    val === 'lofi-art' ||
    val === 'frutiger-aero'
  );
}

export function isValidThemeVariant(val: unknown): val is ThemeVariant {
  return val === 'light' || val === 'dark';
}

export function getThemeColor(theme: AppTheme, variant: ThemeVariant): string {
  if (theme === 'cutecore') return '#ffeaf2';
  if (theme === 'analog-horror') return '#0a0b0d';
  if (theme === 'brazilian-phonk') return '#09090d';
  if (theme === 'future-funk') return '#170b2b';
  if (theme === 'lofi-art') return '#1c1f33';
  if (theme === 'frutiger-aero') return '#cfeef7';
  return variant === 'dark' ? '#171512' : '#ece2c6';
}

export function applyThemeToDocument(
  theme: AppTheme,
  variant: ThemeVariant,
): void {
  const safeTheme = isValidAppTheme(theme) ? theme : DEFAULT_THEME;
  const safeVariant = isValidThemeVariant(variant)
    ? variant
    : DEFAULT_THEME_VARIANT;

  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.dataset.theme = safeTheme;
    root.dataset.variant = safeTheme === 'notebook' ? safeVariant : 'default';

    const color = getThemeColor(safeTheme, safeVariant);
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = color;
  }

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, safeTheme);
      window.localStorage.setItem(THEME_VARIANT_STORAGE_KEY, safeVariant);
    } catch {
      // Ignore storage failures (e.g. private browsing restrictions).
    }
  }
}
