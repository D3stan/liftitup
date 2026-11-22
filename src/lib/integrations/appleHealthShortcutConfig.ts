/**
 * Parses and validates an optional configured iCloud Shortcut URL from env.
 * Only allows http: or https: URLs; returns null if unset, blank, or invalid.
 */
export function parseConfiguredShortcutUrl(
  raw: string | undefined | null,
): string | null {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Reads `APPLE_HEALTH_SHORTCUT_URL` from the server runtime environment so
 * Docker deployments can update `.env` without rebuilding the image.
 */
export function getConfiguredAppleHealthShortcutUrl(): string | null {
  return parseConfiguredShortcutUrl(process.env.APPLE_HEALTH_SHORTCUT_URL);
}
