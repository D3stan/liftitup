import crypto from 'node:crypto';
import type {
  AnalyticsSummary,
  AppleHealthWorkout,
  PrecompiledSession,
  PrRecord,
  RankTier,
  Schedule,
  ScheduleDay,
  SessionDebriefImpact,
  UserProfile,
  VariationSwapResponse,
  WorkoutSession,
  WorkoutSet,
} from '@/types/domain';
import { getDb } from './index';
import {
  DAY_NAMES,
  SCHEDULE_PRESETS,
  getExerciseById,
} from '@/lib/hypertrophy/exercises';
import {
  computeEffectiveLoadKg,
  computeExerciseE1rm,
  computeVariationSwap,
} from '@/lib/hypertrophy/equivalence';
import { precompileSessionForUser } from '@/lib/hypertrophy/precompiler';
import { buildAnalyticsSummary } from '@/lib/hypertrophy/analytics';
import {
  calculateSessionImpact,
  computeLevelAndRank,
} from '@/lib/gamification/engine';

interface DbUserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  bodyweight_kg: number;
  unit: string;
  xp: number;
  level: number;
  rank_tier: string;
  current_streak: number;
  best_streak: number;
  streak_shields: number;
  api_key: string;
  apple_fitness_enabled: number;
  created_at: string;
}

function mapUserRow(row: DbUserRow): UserProfile {
  const rankState = computeLevelAndRank(row.xp);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bodyweightKg: Number(row.bodyweight_kg) || 78.5,
    unit: row.unit === 'lb' ? 'lb' : 'kg',
    xp: Number(row.xp) || 0,
    xpToNextLevel: rankState.xpToNextLevel,
    level: rankState.level,
    rankTier: (rankState.rankTier || row.rank_tier) as RankTier,
    currentStreak: Number(row.current_streak) || 0,
    bestStreak: Number(row.best_streak) || 0,
    streakShields: Number(row.streak_shields) || 0,
    apiKey: row.api_key,
    appleFitnessEnabled: Boolean(row.apple_fitness_enabled),
    createdAt: row.created_at,
  };
}

export function getUserById(userId: string): UserProfile | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(userId) as DbUserRow | undefined;
  return row ? mapUserRow(row) : null;
}

export function getUserByUsername(username: string): UserProfile | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
    .get(username) as DbUserRow | undefined;
  return row ? mapUserRow(row) : null;
}

export function getUserByApiKey(apiKey: string): UserProfile | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM users WHERE api_key = ?')
    .get(apiKey) as DbUserRow | undefined;
  return row ? mapUserRow(row) : null;
}

export function getDefaultDemoUser(): UserProfile {
  const alex = getUserByUsername('alex');
  if (alex) return alex;
  const all = listUsers();
  return all[0];
}

export function listUsers(): UserProfile[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM users ORDER BY xp DESC')
    .all() as unknown as DbUserRow[];
  return rows.map(mapUserRow);
}

export function createUser(params: {
  username: string;
  displayName?: string;
  password?: string;
  bodyweightKg?: number;
}): UserProfile {
  const db = getDb();
  const cleanUsername = params.username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  if (!cleanUsername) {
    throw new Error('Invalid username');
  }
  const existing = getUserByUsername(cleanUsername);
  if (existing) {
    throw new Error(`Username @${cleanUsername} is already registered`);
  }

  const id = `user-${crypto.randomUUID().slice(0, 8)}`;
  const apiKey = `liu_${crypto.randomBytes(16).toString('hex')}`;
  const bw = Number(params.bodyweightKg) || 75;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (
      id, username, display_name, password_hash, bodyweight_kg, unit,
      xp, level, rank_tier, current_streak, best_streak, streak_shields,
      api_key, apple_fitness_enabled, created_at
    ) VALUES (?, ?, ?, ?, ?, 'kg', 500, 1, 'Iron', 1, 1, 1, ?, 1, ?)`
  ).run(
    id,
    cleanUsername,
    params.displayName?.trim() || cleanUsername,
    params.password || '',
    bw,
    apiKey,
    now
  );

  // Seed default 5-day schedule
  const preset = SCHEDULE_PRESETS.upper_lower_ppl_5d;
  db.prepare(
    `INSERT INTO schedules (id, user_id, name, split_type, days_json, is_active, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(
    `sched-${id}`,
    id,
    preset.name,
    preset.splitType,
    JSON.stringify(preset.days),
    now
  );

  return getUserById(id)!;
}

export function updateUser(
  userId: string,
  updates: {
    displayName?: string;
    bodyweightKg?: number;
    unit?: 'kg' | 'lb';
    appleFitnessEnabled?: boolean;
  }
): UserProfile {
  const db = getDb();
  const current = getUserById(userId);
  if (!current) throw new Error('User not found');

  const newDisplayName = updates.displayName ?? current.displayName;
  const newBw =
    updates.bodyweightKg !== undefined && updates.bodyweightKg > 25
      ? Number(updates.bodyweightKg)
      : current.bodyweightKg;
  const newUnit = updates.unit ?? current.unit;
  const newApple =
    updates.appleFitnessEnabled !== undefined
      ? updates.appleFitnessEnabled
        ? 1
        : 0
      : current.appleFitnessEnabled
      ? 1
      : 0;

  db.prepare(
    `UPDATE users
     SET display_name = ?, bodyweight_kg = ?, unit = ?, apple_fitness_enabled = ?
     WHERE id = ?`
  ).run(newDisplayName, newBw, newUnit, newApple, userId);

  return getUserById(userId)!;
}

export function rotateUserApiKey(userId: string): UserProfile {
  const db = getDb();
  const newKey = `liu_${crypto.randomBytes(16).toString('hex')}`;
  db.prepare('UPDATE users SET api_key = ? WHERE id = ?').run(newKey, userId);
  return getUserById(userId)!;
}

export function getActiveSchedule(userId: string): Schedule {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT * FROM schedules WHERE user_id = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1'
    )
    .get(userId) as
    | {
        id: string;
        user_id: string;
        name: string;
        split_type: Schedule['splitType'];
        days_json: string;
        is_active: number;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    const preset = SCHEDULE_PRESETS.upper_lower_ppl_5d;
    const id = `sched-${userId}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO schedules (id, user_id, name, split_type, days_json, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    ).run(
      id,
      userId,
      preset.name,
      preset.splitType,
      JSON.stringify(preset.days),
      now
    );
    return {
      id,
      userId,
      name: preset.name,
      splitType: preset.splitType,
      isActive: true,
      days: preset.days,
      updatedAt: now,
    };
  }

  let days: ScheduleDay[] = [];
  try {
    days = JSON.parse(row.days_json);
  } catch {
    days = SCHEDULE_PRESETS.upper_lower_ppl_5d.days;
  }

  // Enrich exerciseName on slots
  for (const d of days) {
    d.dayName = DAY_NAMES[d.dayOfWeek] || d.dayName;
    for (const s of d.slots || []) {
      const ex = getExerciseById(s.exerciseId);
      s.exerciseName = ex.name;
      s.movementSlot = s.movementSlot || ex.movementSlot;
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    splitType: row.split_type,
    isActive: Boolean(row.is_active),
    days,
    updatedAt: row.updated_at,
  };
}

export function upsertUserSchedule(
  userId: string,
  payload: {
    name?: string;
    splitType?: Schedule['splitType'];
    days: ScheduleDay[];
  }
): Schedule {
  const db = getDb();
  const current = getActiveSchedule(userId);
  const now = new Date().toISOString();

  const normalizedDays: ScheduleDay[] = Array.from({ length: 7 }, (_, dow) => {
    const incoming = payload.days?.find((d) => Number(d.dayOfWeek) === dow);
    if (!incoming) {
      return {
        id: `day-${dow}`,
        dayOfWeek: dow,
        dayName: DAY_NAMES[dow],
        routineLabel: 'Rest Day',
        isRestDay: true,
        focusMuscles: [],
        slots: [],
      };
    }
    const slots = (incoming.slots || []).map((s, idx) => {
      const ex = getExerciseById(s.exerciseId);
      return {
        id: s.id || `slot-${dow}-${idx}`,
        slotIndex: idx,
        movementSlot: s.movementSlot || ex.movementSlot,
        exerciseId: ex.id,
        exerciseName: ex.name,
        targetSets: Math.max(1, Number(s.targetSets) || 3),
        repRangeMin: Math.max(1, Number(s.repRangeMin) || ex.defaultRepMin),
        repRangeMax: Math.max(
          2,
          Number(s.repRangeMax) || ex.defaultRepMax
        ),
        targetRir: s.targetRir !== undefined ? Number(s.targetRir) : 1,
        restSeconds: Number(s.restSeconds) || ex.defaultRestSeconds,
        notes: s.notes || '',
      };
    });
    const focusSet = new Set(slots.map((sl) => getExerciseById(sl.exerciseId).primaryMuscle));

    return {
      id: incoming.id || `day-${dow}`,
      dayOfWeek: dow,
      dayName: DAY_NAMES[dow],
      routineLabel:
        incoming.routineLabel ||
        (incoming.isRestDay ? 'Rest Day' : `${DAY_NAMES[dow]} Hypertrophy`),
      isRestDay: Boolean(incoming.isRestDay || slots.length === 0),
      focusMuscles:
        incoming.focusMuscles && incoming.focusMuscles.length > 0
          ? incoming.focusMuscles
          : Array.from(focusSet),
      slots,
    };
  });

  db.prepare(
    `UPDATE schedules
     SET name = ?, split_type = ?, days_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    payload.name || current.name,
    payload.splitType || current.splitType,
    JSON.stringify(normalizedDays),
    now,
    current.id,
    userId
  );

  return getActiveSchedule(userId);
}

export function shiftScheduleDays(userId: string, shiftBy = 1): Schedule {
  const current = getActiveSchedule(userId);
  const shiftedDays: ScheduleDay[] = Array.from({ length: 7 }, (_, newDow) => {
    const srcDow = (((newDow - shiftBy) % 7) + 7) % 7;
    const srcDay = current.days.find((d) => d.dayOfWeek === srcDow) || current.days[0];
    return {
      ...srcDay,
      id: `day-${newDow}`,
      dayOfWeek: newDow,
      dayName: DAY_NAMES[newDow],
    };
  });
  return upsertUserSchedule(userId, {
    name: current.name,
    splitType: current.splitType,
    days: shiftedDays,
  });
}

export function getRecentSessions(
  userId: string,
  limit = 40
): WorkoutSession[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM workout_sessions
       WHERE user_id = ?
       ORDER BY completed_at DESC
       LIMIT ?`
    )
    .all(userId, limit) as unknown as {
    id: string;
    user_id: string;
    schedule_day_id: string | null;
    routine_label: string;
    started_at: string;
    completed_at: string;
    duration_minutes: number;
    user_bodyweight_kg: number;
    total_volume_kg: number;
    total_sets: number;
    xp_earned: number;
    prs_count: number;
    notes: string;
    apple_watch_kcal: number | null;
    apple_watch_avg_hr: number | null;
    apple_watch_max_hr: number | null;
    sets_json: string;
    cid: string | null;
  }[];

  return rows.map((r) => {
    let sets: WorkoutSet[] = [];
    try {
      sets = JSON.parse(r.sets_json);
    } catch {
      sets = [];
    }
    return {
      id: r.id,
      userId: r.user_id,
      scheduleDayId: r.schedule_day_id,
      routineLabel: r.routine_label,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      durationMinutes: r.duration_minutes,
      userBodyweightKg: r.user_bodyweight_kg,
      totalVolumeKg: r.total_volume_kg,
      totalSets: r.total_sets,
      xpEarned: r.xp_earned,
      prsCount: r.prs_count,
      notes: r.notes,
      appleWatchKcal: r.apple_watch_kcal,
      appleWatchAvgHr: r.apple_watch_avg_hr,
      appleWatchMaxHr: r.apple_watch_max_hr,
      sets,
      cid: r.cid || undefined,
    };
  });
}

export function getSessionSwapsForDate(
  userId: string,
  dateKey: string
): Record<string, string> {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT schedule_slot_id, exercise_id FROM session_swaps WHERE user_id = ? AND date_key = ?'
    )
    .all(userId, dateKey) as unknown as {
    schedule_slot_id: string;
    exercise_id: string;
  }[];

  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.schedule_slot_id] = r.exercise_id;
  }
  return map;
}

export function getPrecompiledSessionForUser(
  userId: string,
  options?: { dayOfWeek?: number; date?: string }
): PrecompiledSession {
  const user = getUserById(userId) || getDefaultDemoUser();
  const schedule = getActiveSchedule(user.id);
  const recentSessions = getRecentSessions(user.id, 30);
  const dateKey = options?.date || new Date().toISOString().slice(0, 10);
  const sessionSwaps = getSessionSwapsForDate(user.id, dateKey);

  return precompileSessionForUser({
    user,
    schedule,
    dayOfWeek: options?.dayOfWeek,
    date: dateKey,
    recentSessions,
    sessionSwaps,
  });
}

export function swapScheduleSlotExercise(params: {
  userId: string;
  fromExerciseId: string;
  toExerciseId: string;
  scheduleSlotId?: string;
  currentWeightKg?: number;
  targetReps?: number;
  targetRir?: number;
  targetSets?: number;
  scope: 'session' | 'schedule';
  dateKey?: string;
}): VariationSwapResponse {
  const db = getDb();
  const user = getUserById(params.userId) || getDefaultDemoUser();
  const schedule = getActiveSchedule(user.id);
  const recentSessions = getRecentSessions(user.id, 25);

  const toEx = getExerciseById(params.toExerciseId);
  const fromEx = getExerciseById(params.fromExerciseId);

  // Determine currentWeightKg or slot canonical e1RM from recent sessions if not explicitly passed
  let refWeightKg = params.currentWeightKg ?? 0;
  let refReps = params.targetReps || toEx.defaultRepMin || 8;
  const refRir = params.targetRir ?? 1;
  const refSets = params.targetSets || 3;

  if (!refWeightKg || refWeightKg <= 0) {
    const matchSess = recentSessions.find((s) =>
      s.sets.some(
        (st) =>
          st.exerciseId === fromEx.id || st.movementSlot === toEx.movementSlot
      )
    );
    const matchSet = matchSess?.sets.find(
      (st) =>
        st.exerciseId === fromEx.id || st.movementSlot === toEx.movementSlot
    );
    if (matchSet) {
      refWeightKg = matchSet.weightKg;
      refReps = params.targetReps || matchSet.reps;
    } else {
      refWeightKg = fromEx.loadType === 'bodyweight_plus' ? 10 : 70;
    }
  }

  const swapResult = computeVariationSwap({
    fromExerciseId: fromEx.id,
    toExerciseId: toEx.id,
    currentWeightKg: refWeightKg,
    targetReps: refReps,
    targetRir: refRir,
    targetSets: refSets,
    userBodyweightKg: user.bodyweightKg,
    scope: params.scope,
  });

  const dateKey = params.dateKey || new Date().toISOString().slice(0, 10);

  if (params.scope === 'schedule') {
    for (const day of schedule.days) {
      for (const slot of day.slots) {
        if (
          (params.scheduleSlotId && slot.id === params.scheduleSlotId) ||
          (!params.scheduleSlotId && slot.exerciseId === fromEx.id)
        ) {
          slot.exerciseId = toEx.id;
          slot.exerciseName = toEx.name;
          slot.movementSlot = toEx.movementSlot;
        }
      }
    }
    upsertUserSchedule(user.id, {
      name: schedule.name,
      splitType: schedule.splitType,
      days: schedule.days,
    });
  } else if (params.scheduleSlotId) {
    db.prepare(
      `INSERT INTO session_swaps (user_id, date_key, schedule_slot_id, exercise_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, date_key, schedule_slot_id)
       DO UPDATE SET exercise_id = excluded.exercise_id`
    ).run(user.id, dateKey, params.scheduleSlotId, toEx.id);
  }

  return swapResult;
}

export function getPrRecords(userId: string): PrRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT * FROM pr_records WHERE user_id = ? ORDER BY achieved_at DESC, e1rm_kg DESC'
    )
    .all(userId) as unknown as {
    id: string;
    user_id: string;
    exercise_id: string;
    exercise_name: string;
    movement_slot: PrRecord['movementSlot'];
    pr_type: PrRecord['prType'];
    weight_kg: number;
    effective_load_kg: number;
    reps: number;
    e1rm_kg: number;
    previous_best_e1rm_kg: number | null;
    achieved_at: string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    exerciseId: r.exercise_id,
    exerciseName: r.exercise_name,
    movementSlot: r.movement_slot,
    prType: r.pr_type,
    weightKg: r.weight_kg,
    effectiveLoadKg: r.effective_load_kg,
    reps: r.reps,
    e1rmKg: r.e1rm_kg,
    previousBestE1rmKg: r.previous_best_e1rm_kg,
    achievedAt: r.achieved_at,
  }));
}

export function logWorkoutSessionWithImpact(
  userId: string,
  payload: {
    scheduleDayId?: string | null;
    routineLabel?: string;
    durationMinutes?: number;
    notes?: string;
    sets: {
      exerciseId: string;
      setNumber?: number;
      weightKg: number;
      reps: number;
      rir?: number;
    }[];
    cid?: string;
  }
): SessionDebriefImpact {
  const db = getDb();
  const user = getUserById(userId) || getDefaultDemoUser();
  const schedule = getActiveSchedule(user.id);
  const previousSessions = getRecentSessions(user.id, 40);
  const existingPrs = getPrRecords(user.id);

  // Idempotency check if cid was already logged
  if (payload.cid) {
    const existingSess = previousSessions.find((s) => s.cid === payload.cid);
    if (existingSess) {
      return calculateSessionImpact({
        user,
        session: existingSess,
        previousSessions: previousSessions.filter((s) => s.id !== existingSess.id),
        schedule,
        prsUnlocked: [],
      });
    }
  }

  const now = new Date();
  const durationMinutes = Math.max(10, Number(payload.durationMinutes) || 52);
  const completedAt = now.toISOString();
  const startedAt = new Date(
    now.getTime() - durationMinutes * 60 * 1000
  ).toISOString();

  const prsUnlocked: PrRecord[] = [];
  const bestByExercise = new Map<string, number>();
  for (const pr of existingPrs) {
    const cur = bestByExercise.get(pr.exerciseId) || 0;
    if (pr.e1rmKg > cur) bestByExercise.set(pr.exerciseId, pr.e1rmKg);
  }

  const enrichedSets: WorkoutSet[] = (payload.sets || []).map((st, idx) => {
    const ex = getExerciseById(st.exerciseId);
    const weightKg = Number(st.weightKg) || 0;
    const reps = Math.max(1, Number(st.reps) || 1);
    const rir = st.rir !== undefined ? Number(st.rir) : 1;
    const effLoad = computeEffectiveLoadKg(ex, weightKg, user.bodyweightKg);
    const e1rm = computeExerciseE1rm(effLoad, reps, rir);

    const prevBest = bestByExercise.get(ex.id) || 0;
    let isPr = false;
    if (e1rm > prevBest && reps >= 1) {
      isPr = true;
      bestByExercise.set(ex.id, e1rm);
      const prRecord: PrRecord = {
        id: `pr-${crypto.randomUUID().slice(0, 8)}`,
        userId: user.id,
        exerciseId: ex.id,
        exerciseName: ex.name,
        movementSlot: ex.movementSlot,
        prType: 'e1rm',
        weightKg,
        effectiveLoadKg: effLoad,
        reps,
        e1rmKg: e1rm,
        previousBestE1rmKg: prevBest > 0 ? prevBest : null,
        achievedAt: completedAt,
      };
      prsUnlocked.push(prRecord);
    }

    return {
      id: `set-${idx + 1}`,
      exerciseId: ex.id,
      exerciseName: ex.name,
      movementSlot: ex.movementSlot,
      setNumber: st.setNumber || idx + 1,
      weightKg,
      effectiveLoadKg: effLoad,
      reps,
      rir,
      e1rmKg: e1rm,
      isPr,
      completedAt,
    };
  });

  const totalVolumeKg = Math.round(
    enrichedSets.reduce(
      (acc, s) => acc + (s.effectiveLoadKg || s.weightKg) * s.reps,
      0
    )
  );

  const sessionId = `sess-${crypto.randomUUID().slice(0, 8)}`;
  const tempSession: WorkoutSession = {
    id: sessionId,
    userId: user.id,
    scheduleDayId: payload.scheduleDayId || null,
    routineLabel: payload.routineLabel || 'Hypertrophy Session',
    startedAt,
    completedAt,
    durationMinutes,
    userBodyweightKg: user.bodyweightKg,
    totalVolumeKg,
    totalSets: enrichedSets.length,
    xpEarned: 0,
    prsCount: prsUnlocked.length,
    notes: payload.notes || '',
    sets: enrichedSets,
    cid: payload.cid,
  };

  const impact = calculateSessionImpact({
    user,
    session: tempSession,
    previousSessions,
    schedule,
    prsUnlocked,
  });

  tempSession.xpEarned = impact.xpEarned;

  db.prepare(
    `INSERT INTO workout_sessions (
      id, user_id, schedule_day_id, routine_label, started_at, completed_at,
      duration_minutes, user_bodyweight_kg, total_volume_kg, total_sets,
      xp_earned, prs_count, notes, sets_json, cid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    user.id,
    tempSession.scheduleDayId ?? null,
    tempSession.routineLabel,
    startedAt,
    completedAt,
    durationMinutes,
    user.bodyweightKg,
    totalVolumeKg,
    enrichedSets.length,
    impact.xpEarned,
    prsUnlocked.length,
    tempSession.notes || '',
    JSON.stringify(enrichedSets),
    payload.cid || sessionId
  );

  const insertPr = db.prepare(`
    INSERT INTO pr_records (
      id, user_id, exercise_id, exercise_name, movement_slot, pr_type,
      weight_kg, effective_load_kg, reps, e1rm_kg, previous_best_e1rm_kg, achieved_at
    ) VALUES (?, ?, ?, ?, ?, 'e1rm', ?, ?, ?, ?, ?, ?)
  `);

  for (const pr of prsUnlocked) {
    insertPr.run(
      pr.id,
      user.id,
      pr.exerciseId,
      pr.exerciseName,
      pr.movementSlot,
      pr.weightKg,
      pr.effectiveLoadKg,
      pr.reps,
      pr.e1rmKg,
      pr.previousBestE1rmKg ?? null,
      pr.achievedAt
    );
  }

  const newXp = user.xp + impact.xpEarned;
  const newRankState = computeLevelAndRank(newXp);
  const newStreak = user.currentStreak + 1;
  const newBestStreak = Math.max(user.bestStreak, newStreak);
  const newShields =
    newStreak % 5 === 0
      ? Math.min(3, user.streakShields + 1)
      : user.streakShields;

  db.prepare(
    `UPDATE users
     SET xp = ?, level = ?, rank_tier = ?, current_streak = ?, best_streak = ?, streak_shields = ?
     WHERE id = ?`
  ).run(
    newXp,
    newRankState.level,
    newRankState.rankTier,
    newStreak,
    newBestStreak,
    newShields,
    user.id
  );

  return impact;
}

export function undoWorkoutSession(
  userId: string,
  sessionId: string
): boolean {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT xp_earned FROM workout_sessions WHERE id = ? AND user_id = ?'
    )
    .get(sessionId, userId) as { xp_earned: number } | undefined;

  if (!row) return false;

  db.prepare('DELETE FROM workout_sessions WHERE id = ? AND user_id = ?').run(
    sessionId,
    userId
  );

  const user = getUserById(userId);
  if (user) {
    const revertedXp = Math.max(0, user.xp - (row.xp_earned || 0));
    const revertedRank = computeLevelAndRank(revertedXp);
    const revertedStreak = Math.max(0, user.currentStreak - 1);
    db.prepare(
      `UPDATE users SET xp = ?, level = ?, rank_tier = ?, current_streak = ? WHERE id = ?`
    ).run(
      revertedXp,
      revertedRank.level,
      revertedRank.rankTier,
      revertedStreak,
      userId
    );
  }

  return true;
}

export function getAppleHealthWorkouts(
  userId: string
): AppleHealthWorkout[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT * FROM apple_health_workouts WHERE user_id = ? ORDER BY started_at DESC LIMIT 30'
    )
    .all(userId) as unknown as {
    id: string;
    user_id: string;
    workout_type: string;
    started_at: string;
    duration_minutes: number;
    active_calories: number;
    avg_heart_rate: number | null;
    max_heart_rate: number | null;
    bodyweight_kg: number | null;
    linked_session_id: string | null;
    source: AppleHealthWorkout['source'];
  }[];

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    workoutType: r.workout_type,
    startedAt: r.started_at,
    durationMinutes: r.duration_minutes,
    activeCalories: r.active_calories,
    avgHeartRate: r.avg_heart_rate,
    maxHeartRate: r.max_heart_rate,
    bodyweightKg: r.bodyweight_kg,
    linkedSessionId: r.linked_session_id,
    source: r.source,
  }));
}

export function saveAppleHealthWorkout(
  userId: string,
  payload: {
    workoutType?: string;
    startedAt?: string;
    durationMinutes: number;
    activeCalories: number;
    avgHeartRate?: number | null;
    maxHeartRate?: number | null;
    bodyweightKg?: number | null;
    source?: AppleHealthWorkout['source'];
  }
): { workout: AppleHealthWorkout; user: UserProfile } {
  const db = getDb();
  const user = getUserById(userId) || getDefaultDemoUser();
  const id = `aw-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = payload.startedAt || new Date().toISOString();
  const datePrefix = startedAt.slice(0, 10);

  // Link to same-day workout session if present
  const sameDaySess = db
    .prepare(
      `SELECT id FROM workout_sessions
       WHERE user_id = ? AND substr(completed_at, 1, 10) = ?
       ORDER BY completed_at DESC LIMIT 1`
    )
    .get(user.id, datePrefix) as { id: string } | undefined;

  if (sameDaySess) {
    db.prepare(
      `UPDATE workout_sessions
       SET apple_watch_kcal = ?, apple_watch_avg_hr = ?, apple_watch_max_hr = ?
       WHERE id = ?`
    ).run(
      Math.round(payload.activeCalories),
      payload.avgHeartRate ? Math.round(payload.avgHeartRate) : null,
      payload.maxHeartRate ? Math.round(payload.maxHeartRate) : null,
      sameDaySess.id
    );
  }

  db.prepare(
    `INSERT INTO apple_health_workouts (
      id, user_id, workout_type, started_at, duration_minutes,
      active_calories, avg_heart_rate, max_heart_rate, bodyweight_kg,
      linked_session_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.id,
    payload.workoutType || 'Traditional Strength Training',
    startedAt,
    Math.round(payload.durationMinutes || 50),
    Math.round(payload.activeCalories || 400),
    payload.avgHeartRate ? Math.round(payload.avgHeartRate) : null,
    payload.maxHeartRate ? Math.round(payload.maxHeartRate) : null,
    payload.bodyweightKg ? Number(payload.bodyweightKg) : null,
    sameDaySess?.id || null,
    payload.source || 'shortcut_webhook'
  );

  // Update bodyweight if included + award +35 XP telemetry sync bonus
  const newBw =
    payload.bodyweightKg && payload.bodyweightKg > 30
      ? Number(payload.bodyweightKg)
      : user.bodyweightKg;
  const newXp = user.xp + 35;
  const newRank = computeLevelAndRank(newXp);

  db.prepare(
    `UPDATE users SET bodyweight_kg = ?, xp = ?, level = ?, rank_tier = ? WHERE id = ?`
  ).run(newBw, newXp, newRank.level, newRank.rankTier, user.id);

  const updatedUser = getUserById(user.id)!;
  return {
    workout: {
      id,
      userId: user.id,
      workoutType: payload.workoutType || 'Traditional Strength Training',
      startedAt,
      durationMinutes: Math.round(payload.durationMinutes || 50),
      activeCalories: Math.round(payload.activeCalories || 400),
      avgHeartRate: payload.avgHeartRate || null,
      maxHeartRate: payload.maxHeartRate || null,
      bodyweightKg: payload.bodyweightKg || null,
      linkedSessionId: sameDaySess?.id || null,
      source: payload.source || 'shortcut_webhook',
    },
    user: updatedUser,
  };
}

export function getFullAnalyticsForUser(userId: string): AnalyticsSummary {
  const user = getUserById(userId) || getDefaultDemoUser();
  const schedule = getActiveSchedule(user.id);
  const sessions = getRecentSessions(user.id, 45);
  const prs = getPrRecords(user.id);
  const appleHealthWorkouts = getAppleHealthWorkouts(user.id);

  return buildAnalyticsSummary({
    user,
    schedule,
    sessions,
    prs,
    appleHealthWorkouts,
  });
}
