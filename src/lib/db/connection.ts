import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '@/lib/logger';
import { SCHEMA_VERSION, initSchema } from './schema';

let dbInstance: DatabaseSync | null = null;
let dbInstancePath: string | null = null;

function resolveDbPath(): string {
  return (
    process.env.DATABASE_PATH ||
    path.join(process.cwd(), 'data', 'liftitup.db')
  );
}

/**
 * Q3 deploy wipe: if an existing SQLite file on disk has legacy v1 tables
 * (missing `schema_version` or `version < SCHEMA_VERSION`), back it up to
 * `<name>.v1-backup-<ts>.db` (removing any stale WAL/SHM sidecars) so a fresh
 * v2 database is initialized cleanly with zero manual intervention.
 */
function backupLegacyDbIfNeeded(targetPath: string): void {
  if (targetPath === ':memory:' || !fs.existsSync(targetPath)) {
    return;
  }
  const stat = fs.statSync(targetPath);
  if (stat.size === 0) {
    return;
  }

  let needsBackup = false;
  let existingTableCount = 0;

  const probe = new DatabaseSync(targetPath);
  try {
    const tables = probe
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as unknown as Array<{ name: string }>;

    existingTableCount = tables.length;
    if (existingTableCount === 0) {
      return;
    }

    const hasSchemaVersion = tables.some((t) => t.name === 'schema_version');
    if (!hasSchemaVersion) {
      needsBackup = true;
    } else {
      const row = probe
        .prepare('SELECT MAX(version) AS version FROM schema_version')
        .get() as { version: number | null } | undefined;
      const version = row?.version === null || row?.version === undefined ? 0 : Number(row.version);
      if (version < SCHEMA_VERSION) {
        needsBackup = true;
      }
    }

    if (needsBackup) {
      try {
        probe.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch {
        // Ignore checkpoint error if DB is not in WAL mode
      }
    }
  } finally {
    probe.close();
  }

  if (!needsBackup) {
    return;
  }

  const dir = path.dirname(targetPath);
  const rawExt = path.extname(targetPath);
  const ext = rawExt || '.db';
  const base = path.basename(targetPath, rawExt);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dir, `${base}.v1-backup-${ts}${ext}`);

  fs.renameSync(targetPath, backupPath);

  for (const sidecar of [`${targetPath}-wal`, `${targetPath}-shm`]) {
    if (fs.existsSync(sidecar)) {
      fs.unlinkSync(sidecar);
    }
  }

  logger.info('backed up legacy v1 database and initializing fresh v2 database', {
    dbPath: targetPath,
    backupPath,
    existingTableCount,
  });
}

/**
 * Returns the singleton SQLite DatabaseSync handle, initializing schema v2
 * and syncing EXERCISE_CATALOG on first connection.
 */
export function getDb(): DatabaseSync {
  const targetPath = resolveDbPath();
  if (dbInstance && dbInstancePath === targetPath) {
    return dbInstance;
  }

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore close errors during path switch
    }
    dbInstance = null;
    dbInstancePath = null;
  }

  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    backupLegacyDbIfNeeded(targetPath);
  }

  const db = new DatabaseSync(targetPath);
  initSchema(db);
  dbInstance = db;
  dbInstancePath = targetPath;
  return db;
}

/**
 * Closes the active database connection (mainly for tests).
 */
export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } finally {
      dbInstance = null;
      dbInstancePath = null;
    }
  }
}

/**
 * Runs a synchronous callback inside an IMMEDIATE SQLite transaction.
 */
export function withTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure if connection closed
    }
    throw err;
  }
}
