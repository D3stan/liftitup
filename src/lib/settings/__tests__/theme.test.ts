import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import module from 'node:module';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { newDb } from 'pg-mem';

const srcRoot = path.resolve(process.cwd(), 'src');
module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && context.parentURL.includes('/node_modules/')) {
      return nextResolve(specifier, context);
    }
    if (specifier === 'next/server') {
      return nextResolve('next/server.js', context);
    }
    let target = specifier;
    if (specifier.startsWith('@/')) {
      target = path.join(srcRoot, specifier.slice(2));
    } else if (
      specifier.startsWith('.') &&
      context.parentURL &&
      !specifier.endsWith('.ts') &&
      !specifier.endsWith('.tsx')
    ) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      target = path.resolve(parentDir, specifier);
    }
    if (target !== specifier) {
      for (const candidate of [
        target,
        `${target}.ts`,
        `${target}.tsx`,
        path.join(target, 'index.ts'),
      ]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const { APP_THEMES, isValidAppTheme, getThemeColor } = await import(
  '@/lib/theme'
);
const { validateSettingsPatch } = await import(
  '@/lib/settings/profileSettings'
);
const { filterSettingsItems } = await import('@/lib/settings/registry');
const { initSchema } = await import('@/lib/db/schema');
const { setTestPool, closeDb } = await import('@/lib/db/connection');

test('frutiger-aero is registered in APP_THEMES with correct metadata', () => {
  const meta = APP_THEMES.find((t) => t.id === 'frutiger-aero');
  assert.ok(meta, 'frutiger-aero should be present in APP_THEMES');
  assert.equal(meta!.name, 'Frutiger Aero');
  assert.equal(meta!.subtitle, 'Glossy aqua & sunlit glass');
  assert.equal(meta!.supportsVariants, false);
  assert.ok(
    APP_THEMES.every((t) => t.id !== 'frutiger-aero' || t === meta),
  );
  // Ensure the theme id is unique in the catalog.
  const ids = APP_THEMES.map((t) => t.id);
  assert.equal(
    ids.filter((id) => id === 'frutiger-aero').length,
    1,
  );
});

test('isValidAppTheme accepts frutiger-aero and rejects unknown ids', () => {
  assert.equal(isValidAppTheme('frutiger-aero'), true);
  assert.equal(isValidAppTheme('notebook'), true);
  assert.equal(isValidAppTheme('lofi-art'), true);
  assert.equal(isValidAppTheme('lofi-art-fake'), false);
  assert.equal(isValidAppTheme('frutiger-aero-2'), false);
  assert.equal(isValidAppTheme(''), false);
  assert.equal(isValidAppTheme(42), false);
  assert.equal(isValidAppTheme(null), false);
  assert.equal(isValidAppTheme(undefined), false);
});

test('getThemeColor returns the glossy aqua brand color for frutiger-aero', () => {
  assert.equal(getThemeColor('frutiger-aero', 'light'), '#cfeef7');
  // frutiger-aero does not support variants, so dark also returns the same base color.
  assert.equal(getThemeColor('frutiger-aero', 'dark'), '#cfeef7');
});

test('validateSettingsPatch accepts frutiger-aero and rejects unknown themes', () => {
  const ok = validateSettingsPatch({ theme: 'frutiger-aero' });
  assert.equal(ok.theme, 'frutiger-aero');

  assert.throws(
    () => validateSettingsPatch({ theme: 'lofi-art-2' }),
    /theme must be "notebook", "cutecore", "analog-horror", "brazilian-phonk", "future-funk", "lofi-art", or "frutiger-aero"/,
  );
  assert.throws(
    () => validateSettingsPatch({ theme: 'frutiger' }),
    /theme must be/,
  );
  // Other themes should still be accepted.
  for (const t of [
    'notebook',
    'cutecore',
    'analog-horror',
    'brazilian-phonk',
    'future-funk',
    'lofi-art',
    'frutiger-aero',
  ] as const) {
    assert.equal(validateSettingsPatch({ theme: t }).theme, t);
  }
});

test('filterSettingsItems matches "frutiger aero" and "glossy" for appearance', () => {
  const matches = filterSettingsItems('frutiger aero');
  assert.ok(
    matches.some((i) => i.href === '/settings/appearance'),
    'expected "frutiger aero" to match the appearance settings item',
  );
  const glossy = filterSettingsItems('glossy');
  assert.ok(
    glossy.some((i) => i.href === '/settings/appearance'),
    'expected "glossy" to match the appearance settings item',
  );
  // "aqua" should also hit (added as a keyword).
  const aqua = filterSettingsItems('aqua');
  assert.ok(
    aqua.some((i) => i.href === '/settings/appearance'),
    'expected "aqua" to match the appearance settings item',
  );
  // Unrelated terms should not match appearance.
  const unrelated = filterSettingsItems('zebra stripe');
  assert.ok(
    !unrelated.some((i) => i.href === '/settings/appearance'),
  );
});

test('frutiger-aero passes the users table CHECK constraint', async () => {
  const memDb = newDb();
  const pgAdapter = memDb.adapters.createPg();
  const innerPool = new pgAdapter.Pool();
  const pool = {
    async connect() {
      return innerPool.connect();
    },
    async query(sql: string, params?: unknown[]) {
      return params && params.length > 0
        ? innerPool.query(sql, params)
        : innerPool.query(sql);
    },
    async end() {
      await innerPool.end();
    },
  } as unknown as Pool;

  setTestPool(pool);
  try {
    await initSchema(pool as Pool);
    const now = new Date().toISOString();
    await (pool as unknown as { query(sql: string, params?: unknown[]): Promise<unknown> }).query(
      `INSERT INTO users (
        id, username, display_name, password_hash, weight_kg,
        unit, timezone, theme, theme_variant,
        enable_set_quality, always_show_rir, enable_set_note_tags, enable_set_note_hint,
        rest_clock_mode, default_workout_view, apple_fitness_enabled,
        is_guest, last_active_at, created_at
      ) VALUES (
        $1, $2, $3, $4, 75, 'kg', 'UTC', $5, 'light',
        0, 0, 1, 1, 'stopwatch', 'list', 1, 1, $6, $6
      )`,
      ['usr_fa', 'fa_user', 'Frutiger User', 'hash', 'frutiger-aero', now],
    );
    // Unknown theme should violate the CHECK constraint.
    await assert.rejects(
      (pool as unknown as { query(sql: string, params?: unknown[]): Promise<unknown> }).query(
        `INSERT INTO users (
          id, username, display_name, password_hash, weight_kg,
          unit, timezone, theme, theme_variant,
          enable_set_quality, always_show_rir, enable_set_note_tags, enable_set_note_hint,
          rest_clock_mode, default_workout_view, apple_fitness_enabled,
          is_guest, last_active_at, created_at
        ) VALUES (
          $1, $2, $3, $4, 75, 'kg', 'UTC', $5, 'light',
          0, 0, 1, 1, 'stopwatch', 'list', 1, 1, $6, $6
        )`,
        ['usr_fa_bad', 'fa_bad', 'Bad Theme', 'hash', 'nonexistent-theme', now],
      ),
    );
  } finally {
    await closeDb();
    setTestPool(null);
  }
});
