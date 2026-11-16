import test from 'node:test';
import assert from 'node:assert/strict';
import module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

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
      const parentDir = path.dirname(new URL(context.parentURL).pathname);
      target = path.resolve(parentDir, specifier);
    }
    if (target !== specifier) {
      for (const candidate of [`${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts')]) {
        if (fs.existsSync(candidate)) {
          return nextResolve(new URL(`file://${candidate}`).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const { getDb, closeDb, SCHEMA_VERSION } = await import('../index.ts');

test('Q3 DB wipe: backs up v1 DB without schema_version and initializes fresh v2 DB', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liftitup-v1wipe-'));
  const dbPath = path.join(tmpDir, 'liftitup.db');
  const prevDbPath = process.env.DATABASE_PATH;

  try {
    // Create a simulated v1 DB with old users + pr_records tables (no schema_version)
    const v1 = new DatabaseSync(dbPath);
    v1.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, xp INTEGER NOT NULL DEFAULT 0);
      INSERT INTO users (id, username, xp) VALUES ('demo-alex', 'alex', 420);
      CREATE TABLE pr_records (id TEXT PRIMARY KEY);
    `);
    v1.close();

    process.env.DATABASE_PATH = dbPath;
    closeDb();

    const db = getDb();
    const versionRow = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    assert.equal(versionRow.version, SCHEMA_VERSION);

    const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    assert.equal(userCount.c, 0, 'Fresh v2 DB must not contain v1 demo users');

    const prTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pr_records'")
      .get();
    assert.equal(prTable, undefined, 'Fresh v2 DB must not contain legacy v1 pr_records table');

    const files = fs.readdirSync(tmpDir);
    const backupFile = files.find((f) => /^liftitup\.v1-backup-.+\.db$/.test(f));
    assert(backupFile, `Expected liftitup.v1-backup-<ts>.db in ${files.join(', ')}`);

    // Verify backup still holds the v1 data
    const backupDb = new DatabaseSync(path.join(tmpDir, backupFile));
    const oldUser = backupDb.prepare('SELECT username, xp FROM users').get() as { username: string; xp: number };
    assert.equal(oldUser.username, 'alex');
    assert.equal(oldUser.xp, 420);
    backupDb.close();

    // Re-opening a valid v2 DB must NOT trigger another backup
    closeDb();
    getDb();
    const backupsAfterReopen = fs
      .readdirSync(tmpDir)
      .filter((f) => /^liftitup\.v1-backup-.+\.db$/.test(f));
    assert.equal(backupsAfterReopen.length, 1);
  } finally {
    closeDb();
    if (prevDbPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = prevDbPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
