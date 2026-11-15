import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { initSchema } from './schema';

let dbInstance: DatabaseSync | null = null;
let dbInstancePath: string | null = null;

function resolveDbPath(): string {
  return (
    process.env.DATABASE_PATH ||
    path.join(process.cwd(), 'data', 'liftitup.db')
  );
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
