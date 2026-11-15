import type { DatabaseSync } from 'node:sqlite';
import type { WorkoutSet } from '@/types/domain';
import { SCHEDULE_PRESETS, getExerciseById } from '@/lib/hypertrophy/exercises';
import {
  computeEffectiveLoadKg,
  computeExerciseE1rm,
} from '@/lib/hypertrophy/equivalence';
import { computeLevelAndRank } from '@/lib/gamification/engine';

export function seedDatabaseIfNeeded(db: DatabaseSync): void {
  const existing = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get('alex') as { id: string } | undefined;

  if (existing) return;

  const now = new Date();
  const demoUserId = 'user-demo-alex';
  const demoBw = 78.5;
  const demoXp = 14850;
  const rankState = computeLevelAndRank(demoXp);

  db.prepare(
    `INSERT INTO users (
      id, username, display_name, password_hash, bodyweight_kg, unit,
      xp, level, rank_tier, current_streak, best_streak, streak_shields,
      api_key, apple_fitness_enabled, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    demoUserId,
    'alex',
    'Alex (Hypertrophy Pro)',
    'demo',
    demoBw,
    'kg',
    demoXp,
    rankState.level,
    rankState.rankTier,
    12,
    19,
    2,
    'liu_demo_alex_hypertrophy_key_2026',
    1,
    new Date(now.getTime() - 60 * 24 * 3600 * 1000).toISOString()
  );

  // Also seed a second gym-partner profile for 1-tap switching demo
  const partnerRank = computeLevelAndRank(6400);
  db.prepare(
    `INSERT INTO users (
      id, username, display_name, password_hash, bodyweight_kg, unit,
      xp, level, rank_tier, current_streak, best_streak, streak_shields,
      api_key, apple_fitness_enabled, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'user-demo-marco',
    'marco',
    'Marco (Training Partner)',
    'demo',
    84.0,
    'kg',
    6400,
    partnerRank.level,
    partnerRank.rankTier,
    5,
    9,
    1,
    'liu_partner_marco_key_2026',
    1,
    new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()
  );

  // Seed Active 5-Day Schedule for Alex & Marco
  const preset = SCHEDULE_PRESETS.upper_lower_ppl_5d;
  db.prepare(
    `INSERT INTO schedules (id, user_id, name, split_type, days_json, is_active, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(
    'sched-demo-alex',
    demoUserId,
    preset.name,
    preset.splitType,
    JSON.stringify(preset.days),
    now.toISOString()
  );

  db.prepare(
    `INSERT INTO schedules (id, user_id, name, split_type, days_json, is_active, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(
    'sched-demo-marco',
    'user-demo-marco',
    preset.name,
    preset.splitType,
    JSON.stringify(preset.days),
    now.toISOString()
  );

  // Seed 8 Weeks of Progressive Overload History for Alex (28 workouts)
  // Week 0 (oldest, 7 weeks ago) -> Week 7 (this week)
  const insertSession = db.prepare(`
    INSERT INTO workout_sessions (
      id, user_id, schedule_day_id, routine_label, started_at, completed_at,
      duration_minutes, user_bodyweight_kg, total_volume_kg, total_sets,
      xp_earned, prs_count, notes, apple_watch_kcal, apple_watch_avg_hr,
      apple_watch_max_hr, sets_json, cid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const bestE1rmByExercise = new Map<
    string,
    { weightKg: number; effectiveLoadKg: number; reps: number; e1rmKg: number; date: string }
  >();

  const makeSets = (
    items: { exId: string; weightKg: number; reps: number[]; rir: number }[]
  ): WorkoutSet[] => {
    const out: WorkoutSet[] = [];
    for (const item of items) {
      const ex = getExerciseById(item.exId);
      item.reps.forEach((r, idx) => {
        const effLoad = computeEffectiveLoadKg(ex, item.weightKg, demoBw);
        const e1rm = computeExerciseE1rm(effLoad, r, item.rir);
        out.push({
          exerciseId: ex.id,
          exerciseName: ex.name,
          movementSlot: ex.movementSlot,
          setNumber: idx + 1,
          weightKg: item.weightKg,
          effectiveLoadKg: effLoad,
          reps: r,
          rir: item.rir,
          e1rmKg: e1rm,
        });
      });
    }
    return out;
  };

  for (let week = 0; week < 8; week++) {
    const weeksAgo = 7 - week;
    // 4-5 sessions per week
    const weekTemplates = [
      {
        dayOffset: weeksAgo * 7 + 5,
        scheduleDayId: 'day-0',
        label: 'Push A — Chest, Front & Side Delts',
        duration: 56,
        kcal: 395 + week * 6,
        avgHr: 126,
        maxHr: 162,
        sets: makeSets([
          {
            exId: 'barbell-bench-press',
            weightKg: 72.5 + Math.floor(week / 2) * 2.5,
            reps: week % 2 === 0 ? [8, 8, 7] : [10, 10, 10],
            rir: 1,
          },
          {
            exId: 'incline-db-press',
            weightKg: 28 + Math.floor(week / 2) * 2,
            reps: week % 2 === 0 ? [9, 9, 8] : [11, 10, 10],
            rir: 1,
          },
          {
            exId: 'pec-deck-fly',
            weightKg: 55 + Math.floor(week / 3) * 2.5,
            reps: [13, 12, 12],
            rir: 1,
          },
          {
            exId: 'cable-lateral-raise',
            weightKg: 12.5 + Math.floor(week / 3) * 1.25,
            reps: [15, 14, 14, 13],
            rir: 1,
          },
          {
            exId: 'overhead-cable-tricep-ext',
            weightKg: 30 + Math.floor(week / 2) * 2.5,
            reps: [13, 12, 12],
            rir: 1,
          },
        ]),
      },
      {
        dayOffset: weeksAgo * 7 + 4,
        scheduleDayId: 'day-1',
        label: 'Pull A — Lat Width, Upper Back & Biceps',
        duration: 58,
        kcal: 418 + week * 5,
        avgHr: 131,
        maxHr: 166,
        // Alternate Lat Pulldown (Pulley) and Weighted Chin-ups across weeks to showcase seamless slot continuity!
        sets: makeSets([
          week % 2 === 0
            ? {
                exId: 'lat-pulldown-pulley',
                weightKg: 70 + Math.floor(week / 2) * 2.5,
                reps: [10, 10, 9],
                rir: 1,
              }
            : {
                exId: 'weighted-chin-up',
                weightKg: 10 + Math.floor(week / 2) * 2.5,
                reps: [8, 8, 7],
                rir: 1,
              },
          {
            exId: 'chest-supported-tbar-row',
            weightKg: 65 + Math.floor(week / 2) * 2.5,
            reps: week % 2 === 0 ? [9, 9, 9] : [11, 10, 10],
            rir: 1,
          },
          {
            exId: 'weighted-chin-up',
            weightKg: 10 + Math.floor(week / 2) * 2.5,
            reps: week % 2 === 0 ? [7, 7, 6] : [9, 8, 8],
            rir: 1,
          },
          {
            exId: 'reverse-pec-deck',
            weightKg: 45 + Math.floor(week / 3) * 2.5,
            reps: [14, 14, 13],
            rir: 1,
          },
          {
            exId: 'bayesian-cable-curl',
            weightKg: 22.5 + Math.floor(week / 3) * 1.25,
            reps: [13, 12, 12],
            rir: 1,
          },
        ]),
      },
      {
        dayOffset: weeksAgo * 7 + 2,
        scheduleDayId: 'day-3',
        label: 'Legs A — Quad Sweep & Hamstring Stretch',
        duration: 64,
        kcal: 470 + week * 7,
        avgHr: 136,
        maxHr: 173,
        sets: makeSets([
          {
            exId: 'barbell-back-squat',
            weightKg: 100 + Math.floor(week / 2) * 5,
            reps: week % 2 === 0 ? [7, 7, 6] : [9, 8, 8],
            rir: 1,
          },
          {
            exId: 'romanian-deadlift',
            weightKg: 105 + Math.floor(week / 2) * 5,
            reps: [8, 8, 8],
            rir: 1,
          },
          {
            exId: 'seated-leg-extension',
            weightKg: 65 + Math.floor(week / 2) * 2.5,
            reps: [13, 12, 12],
            rir: 1,
          },
          {
            exId: 'seated-leg-curl',
            weightKg: 60 + Math.floor(week / 2) * 2.5,
            reps: [13, 12, 12],
            rir: 1,
          },
          {
            exId: 'standing-calf-raise',
            weightKg: 80 + Math.floor(week / 2) * 5,
            reps: [14, 13, 13, 12],
            rir: 1,
          },
        ]),
      },
      {
        dayOffset: weeksAgo * 7 + 1,
        scheduleDayId: 'day-4',
        label: 'Upper B — V-Taper, Delts & Arms Specialization',
        duration: 54,
        kcal: 405 + week * 5,
        avgHr: 128,
        maxHr: 164,
        sets: makeSets([
          {
            exId: 'weighted-chin-up',
            weightKg: 12.5 + Math.floor(week / 2) * 2.5,
            reps: [8, 8, 7],
            rir: 1,
          },
          {
            exId: 'incline-barbell-press',
            weightKg: 67.5 + Math.floor(week / 2) * 2.5,
            reps: [8, 8, 8],
            rir: 1,
          },
          {
            exId: 'seated-cable-row',
            weightKg: 67.5 + Math.floor(week / 2) * 2.5,
            reps: [10, 10, 10],
            rir: 1,
          },
          {
            exId: 'seated-db-shoulder-press',
            weightKg: 24 + Math.floor(week / 3) * 2,
            reps: [10, 9, 9],
            rir: 1,
          },
          {
            exId: 'incline-db-curl',
            weightKg: 14 + Math.floor(week / 3) * 1,
            reps: [12, 11, 11],
            rir: 1,
          },
          {
            exId: 'rope-tricep-pushdown',
            weightKg: 32.5 + Math.floor(week / 3) * 2.5,
            reps: [13, 12, 12],
            rir: 1,
          },
        ]),
      },
    ];

    for (const tpl of weekTemplates) {
      if (tpl.dayOffset <= 0) continue; // Keep today ready to log!
      const sessionDate = new Date(
        now.getTime() - tpl.dayOffset * 24 * 3600 * 1000
      );
      const completedAt = sessionDate.toISOString();
      const startedAt = new Date(
        sessionDate.getTime() - tpl.duration * 60 * 1000
      ).toISOString();

      const totalVol = Math.round(
        tpl.sets.reduce(
          (acc, s) => acc + (s.effectiveLoadKg || s.weightKg) * s.reps,
          0
        )
      );
      let prsInSession = 0;

      for (const st of tpl.sets) {
        const prevBest = bestE1rmByExercise.get(st.exerciseId);
        const e1rm = st.e1rmKg || 0;
        if (!prevBest || e1rm > prevBest.e1rmKg) {
          bestE1rmByExercise.set(st.exerciseId, {
            weightKg: st.weightKg,
            effectiveLoadKg: st.effectiveLoadKg || st.weightKg,
            reps: st.reps,
            e1rmKg: e1rm,
            date: completedAt,
          });
          if (week >= 5) prsInSession++;
        }
      }

      const sessId = `sess-seed-w${week}-${tpl.scheduleDayId}`;
      insertSession.run(
        sessId,
        demoUserId,
        tpl.scheduleDayId,
        tpl.label,
        startedAt,
        completedAt,
        tpl.duration,
        demoBw,
        totalVol,
        tpl.sets.length,
        520 + prsInSession * 200,
        prsInSession,
        week === 7
          ? 'Felt strong on top set — ready for Double-Progression load jump!'
          : '',
        tpl.kcal,
        tpl.avgHr,
        tpl.maxHr,
        JSON.stringify(tpl.sets),
        sessId
      );
    }
  }

  // Insert PR Records from bestE1rmByExercise
  const insertPr = db.prepare(`
    INSERT INTO pr_records (
      id, user_id, exercise_id, exercise_name, movement_slot, pr_type,
      weight_kg, effective_load_kg, reps, e1rm_kg, previous_best_e1rm_kg, achieved_at
    ) VALUES (?, ?, ?, ?, ?, 'e1rm', ?, ?, ?, ?, ?, ?)
  `);

  for (const [exId, best] of bestE1rmByExercise.entries()) {
    const ex = getExerciseById(exId);
    insertPr.run(
      `pr-seed-${exId}`,
      demoUserId,
      ex.id,
      ex.name,
      ex.movementSlot,
      best.weightKg,
      best.effectiveLoadKg,
      best.reps,
      best.e1rmKg,
      Number((best.e1rmKg * 0.94).toFixed(1)),
      best.date
    );
  }

  // Seed 3 Synced Apple Watch Workouts
  const insertAw = db.prepare(`
    INSERT INTO apple_health_workouts (
      id, user_id, workout_type, started_at, duration_minutes,
      active_calories, avg_heart_rate, max_heart_rate, bodyweight_kg,
      linked_session_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertAw.run(
    'aw-seed-1',
    demoUserId,
    'Traditional Strength Training',
    new Date(now.getTime() - 1 * 24 * 3600 * 1000).toISOString(),
    54,
    442,
    129,
    165,
    78.5,
    'sess-seed-w7-day-4',
    'demo_seed'
  );
  insertAw.run(
    'aw-seed-2',
    demoUserId,
    'Traditional Strength Training',
    new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString(),
    64,
    518,
    136,
    174,
    78.5,
    'sess-seed-w7-day-3',
    'demo_seed'
  );
  insertAw.run(
    'aw-seed-3',
    demoUserId,
    'Functional Strength Training',
    new Date(now.getTime() - 4 * 24 * 3600 * 1000).toISOString(),
    58,
    455,
    131,
    167,
    78.4,
    'sess-seed-w7-day-1',
    'demo_seed'
  );
}
