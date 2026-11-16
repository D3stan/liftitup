import test from 'node:test';
import assert from 'node:assert/strict';
import module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const srcRoot = path.resolve(process.cwd(), 'src');
module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && context.parentURL.includes('/node_modules/')) {
      return nextResolve(specifier, context);
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

const {
  DRAFT_PREFIX,
  adoptLegacyWorkoutDrafts,
  buildUserDraftKey,
  clearAllUserDrafts,
  clearUserWorkoutDraft,
  loadUserWorkoutDraft,
  loadWorkoutDraft,
  saveUserWorkoutDraft,
  saveWorkoutDraft,
} = await import('@/lib/offline/outbox');

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
    dumpKeys() {
      return Array.from(map.keys());
    },
  };
}

test('user-scoped workout drafts are isolated per user', () => {
  const storage = createMemoryStorage();
  const baseKey = 'new:2026-11-16:planned';

  saveUserWorkoutDraft('usr_alice', baseKey, { title: 'Alice Push' }, storage);
  saveUserWorkoutDraft('usr_bob', baseKey, { title: 'Bob Pull' }, storage);

  assert.deepEqual(loadUserWorkoutDraft('usr_alice', baseKey, storage), {
    title: 'Alice Push',
  });
  assert.deepEqual(loadUserWorkoutDraft('usr_bob', baseKey, storage), {
    title: 'Bob Pull',
  });

  clearUserWorkoutDraft('usr_alice', baseKey, storage);
  assert.equal(loadUserWorkoutDraft('usr_alice', baseKey, storage), null);
  assert.deepEqual(loadUserWorkoutDraft('usr_bob', baseKey, storage), {
    title: 'Bob Pull',
  });
});

test('legacy un-scoped draft is adopted once by logged-in user and never seen by second user', () => {
  const storage = createMemoryStorage();
  const baseKey = 'new:2026-11-16:planned';

  // Simulate legacy un-scoped draft written before Phase 1
  saveWorkoutDraft(baseKey, { title: 'In-Progress Legs' }, storage);
  assert.ok(storage.getItem(`${DRAFT_PREFIX}${baseKey}`));

  // User A loads the draft -> adopted to User A and legacy key removed
  const aliceLoaded = loadUserWorkoutDraft<{ title: string }>(
    'usr_alice',
    baseKey,
    storage,
  );
  assert.deepEqual(aliceLoaded, { title: 'In-Progress Legs' });
  assert.equal(storage.getItem(`${DRAFT_PREFIX}${baseKey}`), null);
  assert.ok(
    storage.getItem(`${DRAFT_PREFIX}${buildUserDraftKey('usr_alice', baseKey)}`),
  );

  // User B on the same device must NOT see User A's draft
  const bobLoaded = loadUserWorkoutDraft<{ title: string }>(
    'usr_bob',
    baseKey,
    storage,
  );
  assert.equal(bobLoaded, null);
});

test('adoptLegacyWorkoutDrafts adopts all un-scoped drafts once without overwriting existing user drafts', () => {
  const storage = createMemoryStorage();

  saveWorkoutDraft('new:2026-11-16:planned', { title: 'Legacy 1' }, storage);
  saveWorkoutDraft('edit:sess_99', { title: 'Legacy Edit' }, storage);
  saveUserWorkoutDraft(
    'usr_alice',
    'new:2026-11-16:planned',
    { title: 'Alice Existing' },
    storage,
  );

  const adopted = adoptLegacyWorkoutDrafts('usr_alice', storage);
  assert.equal(adopted, 1); // Only edit:sess_99 was newly adopted; existing was preserved
  assert.deepEqual(
    loadUserWorkoutDraft('usr_alice', 'new:2026-11-16:planned', storage),
    { title: 'Alice Existing' },
  );
  assert.deepEqual(
    loadUserWorkoutDraft('usr_alice', 'edit:sess_99', storage),
    { title: 'Legacy Edit' },
  );
  assert.equal(loadWorkoutDraft('new:2026-11-16:planned', storage), null);
  assert.equal(loadWorkoutDraft('edit:sess_99', storage), null);
});

test('clearAllUserDrafts clears all drafts for a user (logout / delete account / delete workout history) without touching other users', () => {
  const storage = createMemoryStorage();

  saveUserWorkoutDraft('usr_alice', 'new:2026-11-15:planned', { n: 1 }, storage);
  saveUserWorkoutDraft('usr_alice', 'new:2026-11-16:planned', { n: 2 }, storage);
  saveUserWorkoutDraft('usr_alice', 'edit:sess_1', { n: 3 }, storage);
  saveUserWorkoutDraft('usr_bob', 'new:2026-11-16:planned', { n: 9 }, storage);

  const removed = clearAllUserDrafts('usr_alice', storage);
  assert.equal(removed, 3);

  assert.equal(
    loadUserWorkoutDraft('usr_alice', 'new:2026-11-15:planned', storage),
    null,
  );
  assert.equal(
    loadUserWorkoutDraft('usr_alice', 'new:2026-11-16:planned', storage),
    null,
  );
  assert.equal(
    loadUserWorkoutDraft('usr_alice', 'edit:sess_1', storage),
    null,
  );
  assert.deepEqual(
    loadUserWorkoutDraft('usr_bob', 'new:2026-11-16:planned', storage),
    { n: 9 },
  );
});
