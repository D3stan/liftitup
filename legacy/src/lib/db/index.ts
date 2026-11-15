import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { seedDatabaseIfNeeded } from './seed';

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  const dbPath =
    process.env.DATABASE_PATH ||
    path.join(process.cwd(), 'data', 'liftitup.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT DEFAULT '',
      bodyweight_kg REAL NOT NULL DEFAULT 78.5,
      unit TEXT NOT NULL DEFAULT 'kg',
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      rank_tier TEXT NOT NULL DEFAULT 'Iron',
      current_streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      streak_shields INTEGER NOT NULL DEFAULT 1,
      api_key TEXT UNIQUE NOT NULL,
      apple_fitness_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      split_type TEXT NOT NULL DEFAULT 'upper_lower',
      days_json TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workout_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      schedule_day_id TEXT,
      routine_label TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 50,
      user_bodyweight_kg REAL NOT NULL DEFAULT 78.5,
      total_volume_kg REAL NOT NULL DEFAULT 0,
      total_sets INTEGER NOT NULL DEFAULT 0,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      prs_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      apple_watch_kcal INTEGER,
      apple_watch_avg_hr INTEGER,
      apple_watch_max_hr INTEGER,
      sets_json TEXT NOT NULL,
      cid TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pr_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      exercise_name TEXT NOT NULL,
      movement_slot TEXT NOT NULL,
      pr_type TEXT NOT NULL DEFAULT 'e1rm',
      weight_kg REAL NOT NULL,
      effective_load_kg REAL NOT NULL,
      reps INTEGER NOT NULL,
      e1rm_kg REAL NOT NULL,
      previous_best_e1rm_kg REAL,
      achieved_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS apple_health_workouts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workout_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      active_calories INTEGER NOT NULL,
      avg_heart_rate INTEGER,
      max_heart_rate INTEGER,
      bodyweight_kg REAL,
      linked_session_id TEXT,
      source TEXT NOT NULL DEFAULT 'shortcut_webhook',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_swaps (
      user_id TEXT NOT NULL,
      date_key TEXT NOT NULL,
      schedule_slot_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      PRIMARY KEY (user_id, date_key, schedule_slot_id)
    );
  `);

  dbInstance = db;
  seedDatabaseIfNeeded(db);
  return db;
}
