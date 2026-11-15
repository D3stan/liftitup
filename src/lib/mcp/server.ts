import crypto from 'node:crypto';
import type { JollyMode, TrackingType, UserProfile } from '@/types/domain';
import { applyAiImport, TRACKING_TYPES } from '@/lib/ai';
import { listBodyMetrics } from '@/lib/db/bodyMetrics';
import { withTransaction } from '@/lib/db/connection';
import { localDateForTimezone } from '@/lib/db/users';
import {
  getActiveSchedule,
  getWorkoutSessionById,
  listScheduleEvents,
  listWorkoutSessions,
} from '@/lib/db/workouts';
import {
  createCustomExercise,
  findExerciseByNameOrAlias,
  getExerciseById,
  listExercises,
  setExerciseHidden,
  updateCustomExercise,
} from '@/lib/exercises/repository';
import { buildUserExportJson } from '@/lib/export';
import { projectCalendar } from '@/lib/schedule/queue';

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'] as const;

export const MCP_SERVER_INFO = {
  name: 'liftitup-mcp',
  version: '2.0.0',
  protocolVersion: '2025-03-26',
};

export const MCP_TOOLS_DEFINITIONS = [
  {
    name: 'get_profile',
    description:
      'Returns the user profile (body stats, unit, timezone, set-quality setting) and recent bodyweight history.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_schedule',
    description:
      'Returns the active rotation-queue schedule and a projected calendar (default 14 days from today in the user timezone).',
    inputSchema: {
      type: 'object',
      properties: {
        daysAhead: {
          type: 'integer',
          minimum: 1,
          maximum: 60,
          description: 'Number of days to project starting today (default 14).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_workout_history',
    description:
      'Returns logged workout sessions with exercises, sets, executionQualityPct, repQualities, and workout/exercise notes.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive).' },
        exerciseId: {
          type: 'string',
          description: 'Filter sessions that include this exercise ID.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Max sessions to return (default 20).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_exercises',
    description:
      'Lists visible built-in catalog and user custom exercises, filterable by query, category, or trackingType.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        category: { type: 'string' },
        trackingType: {
          type: 'string',
          enum: [...TRACKING_TYPES],
        },
        includeHidden: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'export_data',
    description:
      'Returns the user full nested JSON export (profile, active schedule, custom/hidden exercises, bodyMetrics, scheduleEvents, and sessions).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_custom_exercise',
    description:
      'Creates a new user custom exercise or updates an existing custom exercise by id or matching name.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional existing custom exercise ID to update.' },
        name: { type: 'string' },
        trackingType: { type: 'string', enum: [...TRACKING_TYPES] },
        equipment: { type: 'string' },
        category: { type: 'string' },
        defaultRestSeconds: { type: 'integer', minimum: 0, maximum: 600 },
        aliases: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'trackingType'],
      additionalProperties: false,
    },
  },
  {
    name: 'hide_exercise',
    description: 'Hides or unhides an exercise in the user library.',
    inputSchema: {
      type: 'object',
      properties: {
        exerciseId: { type: 'string' },
        hidden: { type: 'boolean', description: 'Defaults to true.' },
      },
      required: ['exerciseId'],
      additionalProperties: false,
    },
  },
  {
    name: 'import_plan',
    description:
      'Validates and applies an AI onboarding/edit plan JSON (profile + rotation schedule), auto-creating unknown exercises as custom and anchoring rotation today.',
    inputSchema: {
      type: 'object',
      properties: {
        rawText: {
          type: 'string',
          description: 'Raw JSON (or markdown-fenced JSON) matching the LiftItUp AI import schema.',
        },
        plan: {
          type: 'object',
          description: 'Direct JSON object matching { profile, schedule }.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'log_workout_session',
    description:
      'Logs a completed workout session with exercises, sets (respecting trackingType), notes, and optional executionQualityPct.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionDate: {
          type: 'string',
          description: 'YYYY-MM-DD (defaults to today in user timezone).',
        },
        title: { type: 'string' },
        scheduleDayId: { type: 'string' },
        isJolly: { type: 'boolean' },
        jollyMode: { type: 'string', enum: ['extra', 'instead'] },
        durationMinutes: { type: 'integer', minimum: 0, maximum: 600 },
        notes: { type: 'string' },
        exercises: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              exerciseId: { type: 'string' },
              exerciseName: { type: 'string' },
              notes: { type: 'string' },
              sets: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  properties: {
                    setNumber: { type: 'integer', minimum: 1 },
                    weightKg: { type: ['number', 'null'], minimum: 0 },
                    reps: { type: ['integer', 'null'], minimum: 0 },
                    timeSeconds: { type: ['integer', 'null'], minimum: 0 },
                    distanceM: { type: ['number', 'null'], minimum: 0 },
                    restSeconds: { type: ['integer', 'null'], minimum: 0 },
                    executionQualityPct: {
                      type: ['integer', 'null'],
                      minimum: 0,
                      maximum: 100,
                    },
                    isCompleted: { type: 'boolean' },
                    repQualities: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          repIndex: { type: 'integer', minimum: 1 },
                          qualityPct: { type: 'integer', minimum: 0, maximum: 100 },
                        },
                        required: ['repIndex', 'qualityPct'],
                      },
                    },
                  },
                },
              },
            },
            required: ['sets'],
          },
        },
      },
      required: ['title', 'exercises'],
      additionalProperties: false,
    },
  },
] as const;

function wrapToolResult(data: unknown, isError = false) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
    isError,
  };
}

function isIsoDate(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val);
  if (!m) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    dt.getUTCFullYear() === Number(m[1]) &&
    dt.getUTCMonth() === Number(m[2]) - 1 &&
    dt.getUTCDate() === Number(m[3])
  );
}

function addDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function isValidTrackingType(val: unknown): val is TrackingType {
  return (
    typeof val === 'string' &&
    (TRACKING_TYPES as readonly string[]).includes(val)
  );
}

function asNullableNumber(
  val: unknown,
  field: string,
  min: number,
  max: number,
  integer = false,
): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new Error(`${field} must be a finite number`);
  }
  if (integer && !Number.isInteger(val)) {
    throw new Error(`${field} must be an integer`);
  }
  if (val < min || val > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return val;
}

function executeToolCall(
  user: UserProfile,
  name: string,
  args: Record<string, unknown>,
) {
  switch (name) {
    case 'get_profile': {
      const recentBodyMetrics = listBodyMetrics(user.id, { limit: 15 });
      return wrapToolResult({
        profile: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          heightCm: user.heightCm,
          weightKg: user.weightKg,
          age: user.age,
          trainingYears: user.trainingYears,
          unit: user.unit,
          timezone: user.timezone,
          enableSetQuality: user.enableSetQuality,
          appleFitnessEnabled: user.appleFitnessEnabled,
        },
        recentBodyMetrics,
      });
    }

    case 'get_schedule': {
      const rawDays = args.daysAhead;
      let daysAhead = 14;
      if (rawDays !== undefined) {
        if (
          typeof rawDays !== 'number' ||
          !Number.isInteger(rawDays) ||
          rawDays < 1 ||
          rawDays > 60
        ) {
          return wrapToolResult(
            { error: 'daysAhead must be an integer between 1 and 60' },
            true,
          );
        }
        daysAhead = rawDays;
      }

      const today = localDateForTimezone(user.timezone);
      const schedule = getActiveSchedule(user.id);
      if (!schedule) {
        return wrapToolResult({ today, schedule: null, projectedCalendar: [] });
      }

      const rangeEnd = addDaysYmd(today, daysAhead - 1);
      const events = listScheduleEvents(user.id, schedule.id, { to: rangeEnd });
      const sessions = listWorkoutSessions(user.id, {
        from: schedule.rotationAnchorDate,
        to: rangeEnd,
        includeExercises: false,
      });

      const projectedCalendar = projectCalendar({
        queue: schedule.days.map((d) => ({
          id: d.id,
          position: d.position,
          label: d.label,
          isRestDay: d.isRestDay,
        })),
        anchorDate: schedule.rotationAnchorDate,
        anchorIndex: schedule.rotationAnchorIndex,
        events: events.map((e) => ({
          id: e.id,
          eventDate: e.eventDate,
          eventType: e.eventType,
          shiftDays: e.shiftDays,
          jollyLabel: e.jollyLabel,
          createdAt: e.createdAt,
        })),
        sessions: sessions.map((s) => ({
          id: s.id,
          sessionDate: s.sessionDate,
          scheduleDayId: s.scheduleDayId,
          isJolly: s.isJolly,
          jollyMode: s.jollyMode,
          title: s.title,
          completedAt: s.completedAt,
        })),
        today,
        rangeStart: today,
        rangeEnd,
      });

      return wrapToolResult({ today, schedule, projectedCalendar });
    }

    case 'get_workout_history': {
      const from = args.from !== undefined ? String(args.from) : undefined;
      const to = args.to !== undefined ? String(args.to) : undefined;
      if (from !== undefined && !isIsoDate(from)) {
        return wrapToolResult({ error: 'from must be YYYY-MM-DD' }, true);
      }
      if (to !== undefined && !isIsoDate(to)) {
        return wrapToolResult({ error: 'to must be YYYY-MM-DD' }, true);
      }

      const exerciseId =
        typeof args.exerciseId === 'string' && args.exerciseId.trim()
          ? args.exerciseId.trim()
          : undefined;

      let limit = 20;
      if (args.limit !== undefined) {
        if (
          typeof args.limit !== 'number' ||
          !Number.isInteger(args.limit) ||
          args.limit < 1 ||
          args.limit > 100
        ) {
          return wrapToolResult(
            { error: 'limit must be an integer between 1 and 100' },
            true,
          );
        }
        limit = args.limit;
      }

      let sessions = listWorkoutSessions(user.id, {
        from,
        to,
        limit: exerciseId ? undefined : limit,
      });

      if (exerciseId) {
        sessions = sessions
          .filter((s) => s.exercises.some((ex) => ex.exerciseId === exerciseId))
          .slice(0, limit);
      }

      return wrapToolResult({ count: sessions.length, sessions });
    }

    case 'list_exercises': {
      const query = typeof args.query === 'string' ? args.query : undefined;
      const category =
        typeof args.category === 'string' ? args.category : undefined;
      const includeHidden =
        typeof args.includeHidden === 'boolean' ? args.includeHidden : false;

      let trackingType: TrackingType | undefined;
      if (args.trackingType !== undefined) {
        if (!isValidTrackingType(args.trackingType)) {
          return wrapToolResult(
            { error: `Invalid trackingType: ${String(args.trackingType)}` },
            true,
          );
        }
        trackingType = args.trackingType;
      }

      const exercises = listExercises(user.id, {
        query,
        category,
        trackingType,
        includeHidden,
      });
      return wrapToolResult({ count: exercises.length, exercises });
    }

    case 'export_data': {
      return wrapToolResult(buildUserExportJson(user));
    }

    case 'upsert_custom_exercise': {
      const rawName = typeof args.name === 'string' ? args.name.trim() : '';
      if (!rawName || rawName.length > 120) {
        return wrapToolResult(
          { error: 'name must be a non-empty string (<= 120 chars)' },
          true,
        );
      }
      if (!isValidTrackingType(args.trackingType)) {
        return wrapToolResult(
          { error: `Invalid trackingType: ${String(args.trackingType)}` },
          true,
        );
      }

      const equipment =
        typeof args.equipment === 'string' ? args.equipment.trim() : undefined;
      const category =
        typeof args.category === 'string' ? args.category.trim() : undefined;
      const defaultRestSeconds =
        args.defaultRestSeconds !== undefined
          ? (asNullableNumber(
              args.defaultRestSeconds,
              'defaultRestSeconds',
              0,
              600,
              true,
            ) ?? 120)
          : undefined;
      const aliases = Array.isArray(args.aliases)
        ? args.aliases.filter((a): a is string => typeof a === 'string')
        : undefined;

      if (typeof args.id === 'string' && args.id.trim()) {
        const updated = updateCustomExercise(user.id, args.id.trim(), {
          name: rawName,
          trackingType: args.trackingType,
          equipment,
          category,
          defaultRestSeconds,
          aliases,
        });
        if (!updated) {
          return wrapToolResult(
            { error: 'Custom exercise not found for this user' },
            true,
          );
        }
        return wrapToolResult({ created: false, exercise: updated });
      }

      const existing = findExerciseByNameOrAlias(user.id, rawName);
      if (existing && existing.isCustom && existing.userId === user.id) {
        const updated = updateCustomExercise(user.id, existing.id, {
          name: rawName,
          trackingType: args.trackingType,
          equipment,
          category,
          defaultRestSeconds,
          aliases,
        });
        return wrapToolResult({ created: false, exercise: updated });
      }

      const created = createCustomExercise(user.id, {
        name: rawName,
        trackingType: args.trackingType,
        equipment,
        category,
        defaultRestSeconds,
        aliases,
      });
      return wrapToolResult({ created: true, exercise: created });
    }

    case 'hide_exercise': {
      const exerciseId =
        typeof args.exerciseId === 'string' ? args.exerciseId.trim() : '';
      if (!exerciseId) {
        return wrapToolResult({ error: 'exerciseId is required' }, true);
      }
      const hidden =
        typeof args.hidden === 'boolean' ? args.hidden : true;
      const ok = setExerciseHidden(user.id, exerciseId, hidden);
      if (!ok) {
        return wrapToolResult({ error: 'Exercise not found' }, true);
      }
      return wrapToolResult({ exerciseId, hidden });
    }

    case 'import_plan': {
      let rawText = '';
      if (typeof args.rawText === 'string') {
        rawText = args.rawText;
      } else if (args.plan && typeof args.plan === 'object') {
        rawText = JSON.stringify(args.plan);
      } else if ('profile' in args || 'schedule' in args) {
        rawText = JSON.stringify(args);
      } else {
        return wrapToolResult(
          { error: 'Provide rawText (string) or plan (object)' },
          true,
        );
      }

      const res = applyAiImport(user, rawText);
      if (!res.valid) {
        return wrapToolResult(
          { valid: false, errors: res.errors },
          true,
        );
      }
      return wrapToolResult({
        valid: true,
        createdCustomExercises: res.createdCustomExercises,
        schedule: res.schedule,
        user: res.user,
      });
    }

    case 'log_workout_session': {
      return handleLogWorkoutSession(user, args);
    }

    default:
      return null;
  }
}

function handleLogWorkoutSession(
  user: UserProfile,
  args: Record<string, unknown>,
) {
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!title || title.length > 120) {
    return wrapToolResult(
      { error: 'title must be a non-empty string (<= 120 chars)' },
      true,
    );
  }

  const sessionDate =
    args.sessionDate !== undefined
      ? args.sessionDate
      : localDateForTimezone(user.timezone);
  if (!isIsoDate(sessionDate)) {
    return wrapToolResult({ error: 'sessionDate must be YYYY-MM-DD' }, true);
  }

  const isJolly = typeof args.isJolly === 'boolean' ? args.isJolly : false;
  let jollyMode: JollyMode | null = null;
  if (isJolly) {
    if (args.jollyMode !== 'extra' && args.jollyMode !== 'instead') {
      return wrapToolResult(
        { error: 'jollyMode ("extra" | "instead") is required when isJolly is true' },
        true,
      );
    }
    jollyMode = args.jollyMode;
  }

  const durationMinutes = asNullableNumber(
    args.durationMinutes,
    'durationMinutes',
    0,
    600,
    true,
  );
  const notes = typeof args.notes === 'string' ? args.notes.trim() : '';

  if (!Array.isArray(args.exercises) || args.exercises.length === 0) {
    return wrapToolResult(
      { error: 'exercises must be a non-empty array' },
      true,
    );
  }

  const activeSchedule = getActiveSchedule(user.id);
  let scheduleId: string | null = activeSchedule?.id ?? null;
  let scheduleDayId: string | null = null;
  if (typeof args.scheduleDayId === 'string' && args.scheduleDayId.trim()) {
    const requestedDayId = args.scheduleDayId.trim();
    const matchedDay = activeSchedule?.days.find((d) => d.id === requestedDayId);
    if (!matchedDay) {
      return wrapToolResult(
        { error: 'scheduleDayId does not belong to user active schedule' },
        true,
      );
    }
    scheduleDayId = matchedDay.id;
  } else if (isJolly) {
    scheduleDayId = null;
  }

  // Resolve and validate all exercises & sets before opening transaction
  const preparedExercises: Array<{
    exerciseId: string;
    notes: string;
    sets: Array<{
      setNumber: number;
      weightKg: number | null;
      reps: number | null;
      timeSeconds: number | null;
      distanceM: number | null;
      restSeconds: number | null;
      executionQualityPct: number | null;
      isCompleted: boolean;
      repQualities: Array<{ repIndex: number; qualityPct: number }>;
    }>;
  }> = [];

  for (let i = 0; i < args.exercises.length; i += 1) {
    const rawEx = args.exercises[i] as Record<string, unknown>;
    if (!rawEx || typeof rawEx !== 'object') {
      return wrapToolResult({ error: `exercises[${i}] must be an object` }, true);
    }

    const exMatch =
      typeof rawEx.exerciseId === 'string' && rawEx.exerciseId.trim()
        ? getExerciseById(user.id, rawEx.exerciseId.trim())
        : typeof rawEx.exerciseName === 'string' && rawEx.exerciseName.trim()
          ? findExerciseByNameOrAlias(user.id, rawEx.exerciseName.trim())
          : null;

    if (!exMatch) {
      return wrapToolResult(
        {
          error: `exercises[${i}]: unknown exercise (provide valid exerciseId or exerciseName)`,
        },
        true,
      );
    }

    if (!Array.isArray(rawEx.sets) || rawEx.sets.length === 0) {
      return wrapToolResult(
        { error: `exercises[${i}].sets must be a non-empty array` },
        true,
      );
    }

    const exNotes = typeof rawEx.notes === 'string' ? rawEx.notes.trim() : '';
    const sets = rawEx.sets.map((rawSet, sIdx) => {
      const s = (rawSet ?? {}) as Record<string, unknown>;
      const setNumber =
        asNullableNumber(s.setNumber, `exercises[${i}].sets[${sIdx}].setNumber`, 1, 100, true) ??
        sIdx + 1;
      const weightKg = asNullableNumber(
        s.weightKg,
        `exercises[${i}].sets[${sIdx}].weightKg`,
        0,
        2000,
      );
      const reps = asNullableNumber(
        s.reps,
        `exercises[${i}].sets[${sIdx}].reps`,
        0,
        1000,
        true,
      );
      const timeSeconds = asNullableNumber(
        s.timeSeconds,
        `exercises[${i}].sets[${sIdx}].timeSeconds`,
        0,
        86400,
        true,
      );
      const distanceM = asNullableNumber(
        s.distanceM,
        `exercises[${i}].sets[${sIdx}].distanceM`,
        0,
        500000,
      );
      const restSeconds = asNullableNumber(
        s.restSeconds,
        `exercises[${i}].sets[${sIdx}].restSeconds`,
        0,
        3600,
        true,
      );

      let repQualities: Array<{ repIndex: number; qualityPct: number }> = [];
      if (Array.isArray(s.repQualities)) {
        repQualities = s.repQualities.map((rq, rIdx) => {
          const rObj = (rq ?? {}) as Record<string, unknown>;
          const repIndex = asNullableNumber(
            rObj.repIndex,
            `exercises[${i}].sets[${sIdx}].repQualities[${rIdx}].repIndex`,
            1,
            1000,
            true,
          );
          const qualityPct = asNullableNumber(
            rObj.qualityPct,
            `exercises[${i}].sets[${sIdx}].repQualities[${rIdx}].qualityPct`,
            0,
            100,
            true,
          );
          if (repIndex === null || qualityPct === null) {
            throw new Error('repQualities entries require repIndex and qualityPct');
          }
          return { repIndex, qualityPct };
        });
      }

      let executionQualityPct = asNullableNumber(
        s.executionQualityPct,
        `exercises[${i}].sets[${sIdx}].executionQualityPct`,
        0,
        100,
        true,
      );
      if (executionQualityPct === null && repQualities.length > 0) {
        const sum = repQualities.reduce((acc, r) => acc + r.qualityPct, 0);
        executionQualityPct = Math.round(sum / repQualities.length);
      }

      const isCompleted =
        typeof s.isCompleted === 'boolean' ? s.isCompleted : true;

      return {
        setNumber,
        weightKg,
        reps,
        timeSeconds,
        distanceM,
        restSeconds,
        executionQualityPct,
        isCompleted,
        repQualities,
      };
    });

    preparedExercises.push({
      exerciseId: exMatch.id,
      notes: exNotes,
      sets,
    });
  }

  const now = new Date().toISOString();
  const sessionId = `ws_${crypto.randomUUID()}`;
  if (!scheduleDayId && isJolly) {
    scheduleId = activeSchedule?.id ?? null;
  }

  const session = withTransaction((db) => {
    db.prepare(`
      INSERT INTO workout_sessions (
        id, user_id, session_date, schedule_id, schedule_day_id,
        is_jolly, jolly_mode, title, started_at, completed_at,
        duration_minutes, user_weight_kg, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      user.id,
      sessionDate,
      scheduleId,
      scheduleDayId,
      isJolly ? 1 : 0,
      jollyMode,
      title,
      now,
      now,
      durationMinutes,
      user.weightKg,
      notes,
    );

    const insertEx = db.prepare(`
      INSERT INTO workout_exercises (id, session_id, exercise_id, order_index, notes)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertSet = db.prepare(`
      INSERT INTO workout_sets (
        id, workout_exercise_id, set_number, weight_kg, reps,
        time_seconds, distance_m, rest_seconds, execution_quality_pct,
        is_completed, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertRepQ = db.prepare(`
      INSERT INTO workout_set_rep_qualities (id, workout_set_id, rep_index, quality_pct)
      VALUES (?, ?, ?, ?)
    `);

    preparedExercises.forEach((ex, orderIndex) => {
      const weId = `we_${crypto.randomUUID()}`;
      insertEx.run(weId, sessionId, ex.exerciseId, orderIndex, ex.notes);

      for (const s of ex.sets) {
        const setId = `wset_${crypto.randomUUID()}`;
        insertSet.run(
          setId,
          weId,
          s.setNumber,
          s.weightKg,
          s.reps,
          s.timeSeconds,
          s.distanceM,
          s.restSeconds,
          s.executionQualityPct,
          s.isCompleted ? 1 : 0,
          now,
        );
        for (const rq of s.repQualities) {
          insertRepQ.run(
            `wrq_${crypto.randomUUID()}`,
            setId,
            rq.repIndex,
            rq.qualityPct,
          );
        }
      }
    });

    return getWorkoutSessionById(user.id, sessionId);
  });

  return wrapToolResult({ session });
}

/**
 * Executes a single JSON-RPC 2.0 MCP request strictly scoped to `user`.
 * Returns `null` when the message is a JSON-RPC notification (no `id`).
 */
export function handleMcpJsonRpcRequest(
  user: UserProfile,
  rpc: JsonRpcRequest,
): JsonRpcResponse | null {
  const hasId = rpc.id !== undefined;
  const id = hasId ? (rpc.id ?? null) : null;
  const method = rpc.method;
  const params = (rpc.params && typeof rpc.params === 'object' ? rpc.params : {}) as Record<
    string,
    unknown
  >;

  if (typeof method !== 'string' || !method) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid Request: missing method' },
    };
  }

  if (method === 'initialize') {
    const requestedVersion =
      typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
    const negotiatedVersion = (
      SUPPORTED_PROTOCOL_VERSIONS as readonly string[]
    ).includes(requestedVersion)
      ? requestedVersion
      : MCP_SERVER_INFO.protocolVersion;

    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: negotiatedVersion,
        serverInfo: {
          name: MCP_SERVER_INFO.name,
          version: MCP_SERVER_INFO.version,
        },
        capabilities: {
          tools: { listChanged: false },
        },
      },
    };
  }

  if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
    if (!hasId) {
      return null;
    }
    return {
      jsonrpc: '2.0',
      id,
      result: {},
    };
  }

  if (method === 'ping') {
    return {
      jsonrpc: '2.0',
      id,
      result: {},
    };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: MCP_TOOLS_DEFINITIONS,
      },
    };
  }

  if (method === 'tools/call') {
    const toolName = typeof params.name === 'string' ? params.name : '';
    const toolArgs =
      params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};

    if (!toolName) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Invalid params: missing tool name' },
      };
    }

    try {
      const toolResult = executeToolCall(user, toolName, toolArgs);
      if (toolResult === null) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        result: toolResult,
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: wrapToolResult(
          { error: err instanceof Error ? err.message : 'Tool execution error' },
          true,
        ),
      };
    }
  }

  if (!hasId) {
    return null;
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  };
}
