import crypto from 'node:crypto';
import type {
  JollyMode,
  ProgressPhotoPose,
  TrackingType,
  UserProfile,
} from '@/types/domain';
import { recordAuditLog, safeRecordEvent } from '@/lib/admin/events';
import { applyAiImport, TRACKING_TYPES } from '@/lib/ai';
import {
  BODY_WEIGHT_MAX_KG,
  BODY_WEIGHT_MIN_KG,
  compareBodyMetricPrecedence,
  computeBodyWeightSummary,
  computeMovingAverage7dSeries,
  filterResolvedPointsByRange,
  isValidIsoDate as isValidBodyIsoDate,
  resolveDailyBodyWeights,
  type BodyWeightRange,
} from '@/lib/body/weight';
import {
  deleteBodyMetricEntry,
  listBodyMetrics,
  updateBodyMetricEntry,
  upsertManualBodyMetricInTx,
} from '@/lib/db/bodyMetrics';
import { query, withTransaction } from '@/lib/db/connection';
import {
  countUserPhotos,
  deleteProgressPhoto,
  getProgressPhotoBlob,
  getProgressPhotoMeta,
  getUserPhotoQuota,
  listProgressPhotos,
} from '@/lib/db/photos';
import {
  deleteUserBodyData,
  deleteUserSplitData,
  deleteUserWorkoutHistory,
  deleteUserAccountInTx,
} from '@/lib/db/userDeletion';
import { getUserById, localDateForTimezone } from '@/lib/db/users';
import {
  getActiveSchedule,
  getWorkoutSessionById,
  getWorkoutSessionsByDate,
  listScheduleEvents,
  listWorkoutSessions,
} from '@/lib/db/workouts';
import {
  createCustomExercise,
  findExerciseByNameOrAlias,
  getExerciseById,
  listExercises,
  listUserExercisePrefs,
  setExerciseHidden,
  setExerciseWeightStepForUser,
  updateCustomExercise,
} from '@/lib/exercises/repository';
import { buildUserExportJson } from '@/lib/export';
import {
  applyLiftitupRestore,
  REPLACE_CONFIRMATION_WORD,
  validateLiftitupRestore,
  type RestoreMode,
  type UnmatchedExerciseResolution,
} from '@/lib/imports/liftitupRestore';
import {
  ingestAppleHealthPayload,
  linkBestUnlinkedHealthWorkoutToSessionInTx,
  listAppleHealthWorkouts,
  relinkAppleHealthWorkout,
} from '@/lib/integrations/appleHealth';
import { isValidPhotoPose } from '@/lib/photos/constants';
import { projectCalendar } from '@/lib/schedule/queue';
import { projectUserCalendar } from '@/lib/schedule/repo';
import {
  createScheduleEventForUser,
  deleteScheduleEventForUser,
  replaceActiveScheduleForUser,
  type PutScheduleBody,
} from '@/lib/schedule/service';
import { DANGER_ACTION_MAP, isDangerAction } from '@/lib/settings/danger';
import {
  applyUserSettingsPatch,
  type SettingsPatchBody,
} from '@/lib/settings/profileSettings';
import { APP_THEMES } from '@/lib/theme';
import { getUserProgressAndRestReport } from '@/lib/workouts/progress';
import {
  applyExerciseSwap,
  deleteWorkoutSession,
  deleteWorkoutSessionsBulk,
  findWorkoutSessionsForBulkDelete,
  updateWorkoutSession,
} from '@/lib/workouts/queries';
import { computeSessionRestSummary, MAX_MEASURED_REST_SECONDS } from '@/lib/workouts/rest';
import {
  parseNullableWeightStepKg,
  resolveDisplayWeightStep,
} from '@/lib/workouts/stepSize';
import type { UpdateWorkoutSessionInput } from '@/lib/workouts/types';
import {
  ANNOTATIONS_DESTRUCTIVE,
  ANNOTATIONS_READ_ONLY,
  ANNOTATIONS_READ_SIDE_EFFECT,
  ANNOTATIONS_WRITE_ADDITIVE,
  ANNOTATIONS_WRITE_IDEMPOTENT,
} from './annotations';
import {
  hashConfirmationPayload,
  requireTwoStepConfirmation,
} from './confirmations';
import {
  buildSignedPhotoUrl,
  consumePhotoLinkRateLimit,
  createSignedPhotoToken,
  getPhotoDownloadSecret,
  MAX_PHOTOS_PER_MCP_CALL,
} from './photoLinks';
import {
  wrapToolResult,
  type McpContentBlock,
  type McpToolDefinition,
  type McpToolResult,
  type ResolvedMcpCaller,
} from './types';

export const ORIGINAL_USER_TOOL_NAMES = new Set<string>([
  'get_profile',
  'get_schedule',
  'get_workout_history',
  'list_exercises',
  'export_data',
  'upsert_custom_exercise',
  'hide_exercise',
  'import_plan',
  'log_workout_session',
]);

export const ORIGINAL_USER_TOOLS_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'get_profile',
    description:
      'Returns the user profile (body stats, unit, timezone, theme, set-quality, rest-clock mode) and recent bodyweight history.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'get_schedule',
    description:
      'Returns the active rotation-queue schedule and a projected calendar (default 14 days from today in the user timezone, or custom startDate/endDate range).',
    inputSchema: {
      type: 'object',
      properties: {
        daysAhead: {
          type: 'integer',
          minimum: 1,
          maximum: 60,
          description: 'Number of days to project starting today (default 14).',
        },
        startDate: {
          type: 'string',
          description: 'Optional YYYY-MM-DD start date (used with endDate).',
        },
        endDate: {
          type: 'string',
          description: 'Optional YYYY-MM-DD end date (max 93 days after startDate).',
        },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'get_workout_history',
    description:
      'Returns logged workout sessions with exercises, sets (including restSeconds, actualRestSeconds, restApproximate), executionQualityPct, repQualities, and workout/exercise notes.',
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
    annotations: ANNOTATIONS_READ_ONLY,
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
    annotations: ANNOTATIONS_READ_ONLY,
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
    annotations: ANNOTATIONS_READ_ONLY,
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
        weightStepKg: {
          type: ['number', 'null'],
          minimum: 0.05,
          maximum: 100,
          description: 'Optional weight stepper increment in kg (null uses global default).',
        },
        aliases: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'trackingType'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_WRITE_IDEMPOTENT,
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
    annotations: ANNOTATIONS_WRITE_IDEMPOTENT,
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
    annotations: ANNOTATIONS_WRITE_IDEMPOTENT,
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
                    actualRestSeconds: { type: ['integer', 'null'], minimum: 0, maximum: 900 },
                    restApproximate: { type: 'boolean' },
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
    annotations: ANNOTATIONS_WRITE_ADDITIVE,
  },
];

const REGISTERED_EXTRA_USER_TOOLS_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'update_settings',
    description:
      'Updates the authenticated user profile and app settings (displayName, unit, timezone, heightCm, age, trainingYears, theme, themeVariant, enableSetQuality, restClockMode, defaultWorkoutView, defaultWeightStepKg, appleFitnessEnabled).',
    inputSchema: {
      type: 'object',
      properties: {
        displayName: { type: 'string', minLength: 1, maxLength: 60 },
        heightCm: { type: ['number', 'null'], minimum: 100, maximum: 250 },
        age: { type: ['integer', 'null'], minimum: 12, maximum: 100 },
        trainingYears: { type: ['number', 'null'], minimum: 0, maximum: 80 },
        unit: { type: 'string', enum: ['kg', 'lb'] },
        timezone: { type: 'string', description: 'Valid IANA timezone name (e.g. Europe/Rome).' },
        theme: { type: 'string', enum: APP_THEMES.map((t) => t.id) },
        themeVariant: { type: 'string', enum: ['light', 'dark'] },
        enableSetQuality: { type: 'boolean' },
        restClockMode: { type: 'string', enum: ['stopwatch', 'countdown'] },
        defaultWorkoutView: { type: 'string', enum: ['list', 'focus'] },
        defaultWeightStepKg: { type: ['number', 'null'], minimum: 0.05, maximum: 100 },
        appleFitnessEnabled: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_WRITE_IDEMPOTENT,
  },
  {
    name: 'manage_schedule',
    description:
      'Manages the active rotation split and calendar actions: update_schedule (edit split days & exercises), skip, postpone (1-3 days), reset, start_jolly_session (extra or instead), undo_event, or swap an exercise for one session or the whole schedule.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'update_schedule',
            'skip',
            'postpone',
            'reset',
            'start_jolly_session',
            'undo_event',
            'swap',
          ],
        },
        name: { type: 'string', description: 'For update_schedule: split name.' },
        days: {
          type: 'array',
          description: 'For update_schedule: ordered rotation days.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              isRestDay: { type: 'boolean' },
              exercises: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    exerciseId: { type: 'string' },
                    targetSets: { type: 'integer', minimum: 1, maximum: 20 },
                    targetReps: { type: ['integer', 'null'], minimum: 1, maximum: 1000 },
                    targetRepsMin: { type: ['integer', 'null'], minimum: 1, maximum: 1000 },
                    targetRepsMax: { type: ['integer', 'null'], minimum: 1, maximum: 1000 },
                    targetTimeSeconds: { type: ['integer', 'null'], minimum: 1, maximum: 86400 },
                    targetWeightKg: { type: ['number', 'null'], minimum: 0, maximum: 2000 },
                    targetDistanceM: { type: ['number', 'null'], minimum: 0, maximum: 1000000 },
                    restSeconds: { type: 'integer', minimum: 0, maximum: 600 },
                    notes: { type: 'string' },
                  },
                  required: ['exerciseId'],
                },
              },
            },
            required: ['label'],
          },
        },
        eventDate: { type: 'string', description: 'YYYY-MM-DD (defaults to today in user timezone).' },
        shiftDays: { type: 'integer', enum: [1, 2, 3], description: 'For postpone: 1, 2, or 3 days.' },
        jollyMode: { type: 'string', enum: ['extra', 'instead'], description: 'For start_jolly_session (defaults to extra).' },
        jollyLabel: { type: 'string', description: 'Optional label for jolly session.' },
        eventId: { type: 'string', description: 'For undo_event: specific schedule event ID to delete.' },
        dateKey: { type: 'string', description: 'For swap: YYYY-MM-DD date of the workout.' },
        scheduleDayExerciseId: { type: 'string', description: 'For swap: planned exercise slot ID.' },
        toExerciseId: { type: 'string', description: 'For swap: replacement exercise ID.' },
        scope: { type: 'string', enum: ['session', 'schedule'], description: 'For swap: session-only or permanent schedule update.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_WRITE_IDEMPOTENT,
  },
  {
    name: 'get_workout_session',
    description:
      'Reads a full logged workout session by sessionId, or all sessions on sessionDate (YYYY-MM-DD), including computed rest summary.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        sessionDate: { type: 'string', description: 'YYYY-MM-DD' },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'edit_workout_session',
    description:
      'Edits any field of a saved workout session (title, sessionDate, startedAt, completedAt, durationMinutes, userWeightKg, isJolly, jollyMode, notes, exercises, sets, restSeconds, actualRestSeconds, restApproximate, executionQualityPct, repQualities).',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        sessionDate: { type: 'string', description: 'YYYY-MM-DD' },
        title: { type: 'string' },
        isJolly: { type: 'boolean' },
        jollyMode: { type: ['string', 'null'], enum: ['extra', 'instead', null] },
        startedAt: { type: 'string', description: 'ISO 8601 timestamp' },
        completedAt: { type: ['string', 'null'], description: 'ISO 8601 timestamp or null' },
        durationMinutes: { type: ['integer', 'null'], minimum: 0, maximum: 600 },
        userWeightKg: { type: ['number', 'null'], minimum: 20, maximum: 400 },
        notes: { type: 'string' },
        exercises: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              exerciseId: { type: 'string' },
              exerciseName: { type: 'string' },
              orderIndex: { type: 'integer', minimum: 0 },
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
                    actualRestSeconds: { type: ['integer', 'null'], minimum: 0, maximum: 900 },
                    restApproximate: { type: 'boolean' },
                    executionQualityPct: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
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
      required: ['sessionId'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_WRITE_IDEMPOTENT,
  },
  {
    name: 'delete_workout_session',
    description: 'Deletes a single logged workout session by sessionId.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_DESTRUCTIVE,
  },
  {
    name: 'delete_workout_sessions_bulk',
    description:
      'Deletes multiple workout sessions matching sessionIds or a from/to date range. Requires two-step confirmation bound to this action, target, and API key.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
        },
        from: { type: 'string', description: 'Inclusive start date YYYY-MM-DD' },
        to: { type: 'string', description: 'Inclusive end date YYYY-MM-DD' },
        confirmationToken: {
          type: 'string',
          description: 'Single-use confirmation token from the first call.',
        },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_DESTRUCTIVE,
  },
  {
    name: 'get_progress_and_rest',
    description:
      'Returns exercise progression series, personal records, weekly session/set counts, and actual rest statistics per session and per exercise.',
    inputSchema: {
      type: 'object',
      properties: {
        range: { type: 'string', enum: ['4w', '12w', 'all'] },
        exerciseId: { type: 'string' },
        sessionLimit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'manage_exercise_step',
    description:
      'Reads, sets, or resets the per-exercise weight stepper increment (or lists all user step overrides).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'set', 'reset', 'list_overrides'],
        },
        exerciseId: { type: 'string' },
        weightStepKg: {
          type: ['number', 'null'],
          minimum: 0.05,
          maximum: 100,
          description: 'For action=set: weight step increment in kg (0.05..100 or null).',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_WRITE_IDEMPOTENT,
  },
  {
    name: 'list_body_weights',
    description:
      'Returns resolved daily body weight series (manual > Apple Health > import), 7-day moving average, 7d/30d summary deltas, and raw entry history.',
    inputSchema: {
      type: 'object',
      properties: {
        range: { type: 'string', enum: ['1m', '3m', '1y', 'all'] },
        from: { type: 'string', description: 'Optional filter start YYYY-MM-DD' },
        to: { type: 'string', description: 'Optional filter end YYYY-MM-DD' },
        includeRawHistory: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'manage_body_weight',
    description:
      'Logs/upserts a manual body weight entry for a date, edits an existing entry, or deletes a body weight entry (syncing profile weight automatically).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['log', 'edit', 'delete'] },
        id: { type: 'string', description: 'Entry ID (required for edit and delete).' },
        weightKg: { type: 'number', minimum: 25, maximum: 300 },
        measuredOn: { type: 'string', description: 'YYYY-MM-DD (defaults to today for log).' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_DESTRUCTIVE,
  },
  {
    name: 'list_photos',
    description:
      'Step 1 of 3 for progress photos: lists metadata only (id, takenOn, pose, weightKg, byteSize, quota) for the key owner, filtered by date range and pose. Returns no image data.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive).' },
        pose: { type: 'string', enum: ['front', 'side', 'back'] },
        limit: { type: 'integer', minimum: 1, maximum: 300 },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_ONLY,
  },
  {
    name: 'browse_photo_thumbnails',
    description:
      'Step 2 of 3 for progress photos: fetches up to 5 300px JPEG thumbnails for the authenticated key owner only. WARNING: returned thumbnail images enter the agent conversation context and are transmitted to the user configured AI provider.',
    inputSchema: {
      type: 'object',
      properties: {
        photoIds: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_PHOTOS_PER_MCP_CALL,
          items: { type: 'string' },
        },
      },
      required: ['photoIds'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_SIDE_EFFECT,
  },
  {
    name: 'get_photo_download_links',
    description:
      'Step 3 of 3 for progress photos: mints short-lived (5 min), opaque, HMAC-signed download URLs (/api/photos/signed/<token>) for up to 5 owner photos so an agent or script can fetch full-size JPEGs out-of-band without putting image bytes into conversation context. Rate-limited per user; requires PHOTO_DOWNLOAD_SECRET.',
    inputSchema: {
      type: 'object',
      properties: {
        photoIds: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_PHOTOS_PER_MCP_CALL,
          items: { type: 'string' },
        },
      },
      required: ['photoIds'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_READ_SIDE_EFFECT,
  },
  {
    name: 'delete_photo',
    description:
      'Deletes one progress photo owned by the caller. Requires two-step confirmation bound to this photo ID and API key.',
    inputSchema: {
      type: 'object',
      properties: {
        photoId: { type: 'string' },
        confirmationToken: { type: 'string' },
      },
      required: ['photoId'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_DESTRUCTIVE,
  },
  {
    name: 'apple_health_tools',
    description:
      'Inspects Apple Health integration status, lists stored Health workouts and session links, runs a strict dry-run payload check, or re-links/unlinks a Health workout.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'list_workouts', 'dry_run_import', 'relink_workout'],
        },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        payload: {
          type: ['object', 'array'],
          description: 'For dry_run_import: Apple Health webhook JSON object or array.',
        },
        healthWorkoutId: { type: 'string', description: 'For relink_workout: Apple Health workout ID.' },
        sessionId: {
          type: ['string', 'null'],
          description: 'For relink_workout: target workout session ID, or null to unlink.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_WRITE_IDEMPOTENT,
  },
  {
    name: 'restore_liftitup_backup',
    description:
      'Validates or applies a full LiftItUp JSON backup in merge or replace mode. Replace mode permanently clears existing workouts, splits, body metrics, and custom exercises before restoring and ALWAYS requires two-step confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['validate', 'apply'] },
        mode: { type: 'string', enum: ['merge', 'replace'] },
        rawText: { type: 'string' },
        exportData: { type: 'object' },
        exerciseResolutions: { type: 'object' },
        confirmationToken: { type: 'string' },
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_DESTRUCTIVE,
  },
  {
    name: 'danger_zone',
    description:
      'Executes a permanent Danger Zone account action (delete_workouts, delete_body, reset_split, or delete_account). ALWAYS requires two-step confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['delete_workouts', 'delete_body', 'reset_split', 'delete_account'],
        },
        confirmationToken: { type: 'string' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS_DESTRUCTIVE,
  },
];

export const ALL_USER_MCP_TOOLS_DEFINITIONS: McpToolDefinition[] = [
  ...ORIGINAL_USER_TOOLS_DEFINITIONS,
  ...REGISTERED_EXTRA_USER_TOOLS_DEFINITIONS,
];

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

function normalizePhotoIdsList(raw: unknown): { ids?: string[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'photoIds must be a non-empty array of photo IDs' };
  }
  const deduped: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) {
      return { error: 'Each photoId must be a non-empty string' };
    }
    const clean = item.trim();
    if (!deduped.includes(clean)) {
      deduped.push(clean);
    }
  }
  if (deduped.length > MAX_PHOTOS_PER_MCP_CALL) {
    return {
      error: `At most ${MAX_PHOTOS_PER_MCP_CALL} photos may be requested per call`,
    };
  }
  return { ids: deduped };
}

async function handleLogWorkoutSession(
  user: UserProfile,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
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

  const activeSchedule = await getActiveSchedule(user.id);
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
      actualRestSeconds: number | null;
      restApproximate: boolean;
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
        ? await getExerciseById(user.id, rawEx.exerciseId.trim())
        : typeof rawEx.exerciseName === 'string' && rawEx.exerciseName.trim()
          ? await findExerciseByNameOrAlias(user.id, rawEx.exerciseName.trim())
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
      const rawActualRest = asNullableNumber(
        s.actualRestSeconds,
        `exercises[${i}].sets[${sIdx}].actualRestSeconds`,
        0,
        86400,
        true,
      );
      const actualRestSeconds =
        rawActualRest !== null && rawActualRest <= MAX_MEASURED_REST_SECONDS
          ? rawActualRest
          : null;
      const restApproximate =
        actualRestSeconds !== null && Boolean(s.restApproximate);

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
        actualRestSeconds,
        restApproximate,
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

  const session = await withTransaction(async () => {
    await query(
      `
      INSERT INTO workout_sessions (
        id, user_id, session_date, schedule_id, schedule_day_id,
        is_jolly, jolly_mode, title, started_at, completed_at,
        duration_minutes, user_weight_kg, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `,
      [
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
      ],
    );

    const insertExSql = `
      INSERT INTO workout_exercises (id, session_id, exercise_id, order_index, notes)
      VALUES ($1, $2, $3, $4, $5)
    `;
    const insertSetSql = `
      INSERT INTO workout_sets (
        id, workout_exercise_id, set_number, weight_kg, reps,
        time_seconds, distance_m, rest_seconds, actual_rest_seconds,
        rest_approximate, execution_quality_pct, is_completed, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;
    const insertRepQSql = `
      INSERT INTO workout_set_rep_qualities (id, workout_set_id, rep_index, quality_pct)
      VALUES ($1, $2, $3, $4)
    `;

    for (let orderIndex = 0; orderIndex < preparedExercises.length; orderIndex += 1) {
      const ex = preparedExercises[orderIndex];
      const weId = `we_${crypto.randomUUID()}`;
      await query(insertExSql, [weId, sessionId, ex.exerciseId, orderIndex, ex.notes]);

      for (const s of ex.sets) {
        const setId = `wset_${crypto.randomUUID()}`;
        await query(insertSetSql, [
          setId,
          weId,
          s.setNumber,
          s.weightKg,
          s.reps,
          s.timeSeconds,
          s.distanceM,
          s.restSeconds,
          s.actualRestSeconds,
          s.restApproximate ? 1 : 0,
          s.executionQualityPct,
          s.isCompleted ? 1 : 0,
          now,
        ]);
        for (const rq of s.repQualities) {
          await query(insertRepQSql, [
            `wrq_${crypto.randomUUID()}`,
            setId,
            rq.repIndex,
            rq.qualityPct,
          ]);
        }
      }
    }

    await linkBestUnlinkedHealthWorkoutToSessionInTx(user.id, {
      id: sessionId,
      startedAt: now,
      completedAt: now,
      durationMinutes,
    });

    return await getWorkoutSessionById(user.id, sessionId);
  });

  return wrapToolResult({ session });
}

async function handleManageSchedule(
  user: UserProfile,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const action = typeof args.action === 'string' ? args.action.trim() : '';
  switch (action) {
    case 'update_schedule': {
      const schedule = await replaceActiveScheduleForUser(user, {
        name: args.name,
        days: args.days,
      } as PutScheduleBody);
      return wrapToolResult({ ok: true, action, schedule });
    }
    case 'skip':
    case 'postpone':
    case 'reset': {
      const event = await createScheduleEventForUser(user, {
        eventDate: args.eventDate,
        eventType: action,
        shiftDays: args.shiftDays,
      });
      return wrapToolResult({ ok: true, action, event });
    }
    case 'start_jolly_session': {
      const jollyMode = args.jollyMode === undefined ? 'extra' : args.jollyMode;
      if (jollyMode !== 'extra' && jollyMode !== 'instead') {
        return wrapToolResult(
          { error: 'jollyMode must be "extra" or "instead"' },
          true,
        );
      }
      const event = await createScheduleEventForUser(user, {
        eventDate: args.eventDate,
        eventType: jollyMode === 'instead' ? 'jolly_instead' : 'jolly_extra',
        jollyLabel: args.jollyLabel,
      });
      return wrapToolResult({ ok: true, action, jollyMode, event });
    }
    case 'undo_event': {
      const deleted = await deleteScheduleEventForUser(user, {
        id: typeof args.eventId === 'string' ? args.eventId : undefined,
        eventDate: typeof args.eventDate === 'string' ? args.eventDate : undefined,
      });
      return wrapToolResult({ ok: true, action, deleted });
    }
    case 'swap': {
      const result = await applyExerciseSwap(user.id, {
        dateKey: typeof args.dateKey === 'string' ? args.dateKey : '',
        scheduleDayExerciseId:
          typeof args.scheduleDayExerciseId === 'string'
            ? args.scheduleDayExerciseId
            : '',
        toExerciseId:
          typeof args.toExerciseId === 'string' ? args.toExerciseId : '',
        scope: args.scope as 'session' | 'schedule',
      });
      return wrapToolResult({ ...result, action });
    }
    default:
      return wrapToolResult(
        {
          error:
            'action must be update_schedule, skip, postpone, reset, start_jolly_session, undo_event, or swap',
        },
        true,
      );
  }
}

async function handleEditWorkoutSession(
  user: UserProfile,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const sessionId =
    typeof args.sessionId === 'string' ? args.sessionId.trim() : '';
  if (!sessionId) {
    return wrapToolResult({ error: 'sessionId is required' }, true);
  }

  const patch: UpdateWorkoutSessionInput = {};
  if (args.sessionDate !== undefined) {
    patch.sessionDate = args.sessionDate as string;
  }
  if (args.title !== undefined) {
    patch.title = args.title as string;
  }
  if (args.isJolly !== undefined) {
    if (typeof args.isJolly !== 'boolean') {
      return wrapToolResult({ error: 'isJolly must be a boolean' }, true);
    }
    patch.isJolly = args.isJolly;
  }
  if (args.jollyMode !== undefined) {
    patch.jollyMode = args.jollyMode as JollyMode | null;
  }
  if (args.startedAt !== undefined) {
    patch.startedAt = args.startedAt as string;
  }
  if (args.completedAt !== undefined) {
    patch.completedAt = args.completedAt as string | null;
  }
  if (args.durationMinutes !== undefined) {
    patch.durationMinutes = args.durationMinutes as number | null;
  }
  if (args.userWeightKg !== undefined) {
    patch.userWeightKg = args.userWeightKg as number | null;
  }
  if (args.notes !== undefined) {
    patch.notes = args.notes as string;
  }

  if (args.exercises !== undefined) {
    if (!Array.isArray(args.exercises) || args.exercises.length === 0) {
      return wrapToolResult(
        { error: 'exercises must be a non-empty array' },
        true,
      );
    }

    const mappedExercises: NonNullable<UpdateWorkoutSessionInput['exercises']> = [];
    for (let i = 0; i < args.exercises.length; i += 1) {
      const rawEx = args.exercises[i] as Record<string, unknown>;
      if (!rawEx || typeof rawEx !== 'object') {
        return wrapToolResult({ error: `exercises[${i}] must be an object` }, true);
      }

      let exerciseId =
        typeof rawEx.exerciseId === 'string' ? rawEx.exerciseId.trim() : '';
      if (!exerciseId && typeof rawEx.exerciseName === 'string' && rawEx.exerciseName.trim()) {
        const found = await findExerciseByNameOrAlias(
          user.id,
          rawEx.exerciseName.trim(),
        );
        if (!found) {
          return wrapToolResult(
            { error: `exercises[${i}]: unknown exerciseName "${rawEx.exerciseName}"` },
            true,
          );
        }
        exerciseId = found.id;
      }

      const rawSets = Array.isArray(rawEx.sets) ? rawEx.sets : [];
      const sets = rawSets.map((rawSet) => {
        const s = (rawSet ?? {}) as Record<string, unknown>;
        const repQualities = Array.isArray(s.repQualities)
          ? (s.repQualities as Array<{ repIndex: number; qualityPct: number }>)
          : undefined;

        let executionQualityPct = s.executionQualityPct as
          | number
          | null
          | undefined;
        if (
          executionQualityPct === undefined &&
          repQualities &&
          repQualities.length > 0
        ) {
          const validPcts = repQualities
            .map((rq) => rq?.qualityPct)
            .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
          if (validPcts.length > 0) {
            executionQualityPct = Math.round(
              validPcts.reduce((acc, v) => acc + v, 0) / validPcts.length,
            );
          }
        }

        return {
          setNumber: s.setNumber as number | undefined,
          weightKg: s.weightKg as number | null | undefined,
          reps: s.reps as number | null | undefined,
          timeSeconds: s.timeSeconds as number | null | undefined,
          distanceM: s.distanceM as number | null | undefined,
          restSeconds: s.restSeconds as number | null | undefined,
          actualRestSeconds: s.actualRestSeconds as number | null | undefined,
          restApproximate: s.restApproximate as boolean | undefined,
          executionQualityPct,
          isCompleted: s.isCompleted as boolean | undefined,
          repQualities,
        };
      });

      mappedExercises.push({
        exerciseId,
        orderIndex:
          typeof rawEx.orderIndex === 'number' ? rawEx.orderIndex : i,
        notes: typeof rawEx.notes === 'string' ? rawEx.notes : undefined,
        sets,
      });
    }
    patch.exercises = mappedExercises;
  }

  if (Object.keys(patch).length === 0) {
    return wrapToolResult(
      { error: 'Provide at least one field to update' },
      true,
    );
  }

  const session = await updateWorkoutSession(user.id, sessionId, patch);
  return wrapToolResult({ session });
}

export async function executeUserToolCall(
  caller: ResolvedMcpCaller,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult | null> {
  const { user, apiKeyId, apiKeyPrefix, origin } = caller;

  if (user.isGuest && !ORIGINAL_USER_TOOL_NAMES.has(name)) {
    return null;
  }

  switch (name) {
    case 'get_profile': {
      const recentBodyMetrics = await listBodyMetrics(user.id, { limit: 15 });
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
          theme: user.theme,
          themeVariant: user.themeVariant,
          enableSetQuality: user.enableSetQuality,
          restClockMode: user.restClockMode,
          defaultWorkoutView: user.defaultWorkoutView,
          defaultWeightStepKg: user.defaultWeightStepKg,
          appleFitnessEnabled: user.appleFitnessEnabled,
          appleHealthLastReceivedAt: user.appleHealthLastReceivedAt,
          appleHealthLastReceivedKind: user.appleHealthLastReceivedKind,
          appleHealthLastReceivedLinked: user.appleHealthLastReceivedLinked,
        },
        recentBodyMetrics,
      });
    }

    case 'get_schedule': {
      const today = localDateForTimezone(user.timezone);
      if (args.startDate !== undefined || args.endDate !== undefined) {
        if (!isIsoDate(args.startDate) || !isIsoDate(args.endDate)) {
          return wrapToolResult(
            { error: 'Both startDate and endDate must be YYYY-MM-DD when specified' },
            true,
          );
        }
        if (args.startDate > args.endDate) {
          return wrapToolResult(
            { error: 'startDate must be on or before endDate' },
            true,
          );
        }
        const diffDays = Math.round(
          (Date.parse(`${args.endDate}T00:00:00Z`) -
            Date.parse(`${args.startDate}T00:00:00Z`)) /
            86_400_000,
        );
        if (diffDays > 93) {
          return wrapToolResult(
            { error: 'Date range cannot exceed 93 days' },
            true,
          );
        }
        const projected = await projectUserCalendar({
          userId: user.id,
          today,
          rangeStart: args.startDate,
          rangeEnd: args.endDate,
        });
        return wrapToolResult({
          today,
          schedule: projected.schedule,
          projectedCalendar: projected.days,
        });
      }

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

      const schedule = await getActiveSchedule(user.id);
      if (!schedule) {
        return wrapToolResult({ today, schedule: null, projectedCalendar: [] });
      }

      const rangeEnd = addDaysYmd(today, daysAhead - 1);
      const events = await listScheduleEvents(user.id, schedule.id, { to: rangeEnd });
      const sessions = await listWorkoutSessions(user.id, {
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
          cid: s.cid,
          isImported: Boolean(s.cid?.startsWith('import:')),
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

      let sessions = await listWorkoutSessions(user.id, {
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
      const queryStr = typeof args.query === 'string' ? args.query : undefined;
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

      const exercises = await listExercises(user.id, {
        query: queryStr,
        category,
        trackingType,
        includeHidden,
      });
      return wrapToolResult({ count: exercises.length, exercises });
    }

    case 'export_data': {
      return wrapToolResult(await buildUserExportJson(user));
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

      let weightStepKg: number | null | undefined;
      if (args.weightStepKg !== undefined) {
        if (args.weightStepKg === null) {
          weightStepKg = null;
        } else if (
          typeof args.weightStepKg !== 'number' ||
          !Number.isFinite(args.weightStepKg) ||
          args.weightStepKg <= 0 ||
          args.weightStepKg > 100
        ) {
          return wrapToolResult(
            { error: 'weightStepKg must be a positive number <= 100 or null' },
            true,
          );
        } else {
          weightStepKg = args.weightStepKg;
        }
      }

      if (typeof args.id === 'string' && args.id.trim()) {
        const updated = await updateCustomExercise(user.id, args.id.trim(), {
          name: rawName,
          trackingType: args.trackingType,
          equipment,
          category,
          defaultRestSeconds,
          weightStepKg,
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

      const existing = await findExerciseByNameOrAlias(user.id, rawName);
      if (existing && existing.isCustom && existing.userId === user.id) {
        const updated = await updateCustomExercise(user.id, existing.id, {
          name: rawName,
          trackingType: args.trackingType,
          equipment,
          category,
          defaultRestSeconds,
          weightStepKg,
          aliases,
        });
        return wrapToolResult({ created: false, exercise: updated });
      }

      const created = await createCustomExercise(user.id, {
        name: rawName,
        trackingType: args.trackingType,
        equipment,
        category,
        defaultRestSeconds,
        weightStepKg,
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
      const ok = await setExerciseHidden(user.id, exerciseId, hidden);
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

      const res = await applyAiImport(user, rawText);
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
      return await handleLogWorkoutSession(user, args);
    }

    case 'update_settings': {
      const updatedUser = await applyUserSettingsPatch(
        user,
        args as SettingsPatchBody,
      );
      return wrapToolResult({ user: updatedUser });
    }

    case 'manage_schedule': {
      return await handleManageSchedule(user, args);
    }

    case 'get_workout_session': {
      if (typeof args.sessionId === 'string' && args.sessionId.trim()) {
        const session = await getWorkoutSessionById(
          user.id,
          args.sessionId.trim(),
        );
        if (!session) {
          return wrapToolResult({ error: 'Workout session not found' }, true);
        }
        return wrapToolResult({
          session,
          restSummary: computeSessionRestSummary(session),
        });
      }
      if (typeof args.sessionDate === 'string' && args.sessionDate.trim()) {
        const date = args.sessionDate.trim();
        if (!isIsoDate(date)) {
          return wrapToolResult({ error: 'sessionDate must be YYYY-MM-DD' }, true);
        }
        const sessions = await getWorkoutSessionsByDate(user.id, date);
        return wrapToolResult({
          sessionDate: date,
          count: sessions.length,
          sessions: sessions.map((s) => ({
            session: s,
            restSummary: computeSessionRestSummary(s),
          })),
        });
      }
      return wrapToolResult(
        { error: 'Provide sessionId or sessionDate (YYYY-MM-DD)' },
        true,
      );
    }

    case 'edit_workout_session': {
      return await handleEditWorkoutSession(user, args);
    }

    case 'delete_workout_session': {
      const sessionId =
        typeof args.sessionId === 'string' ? args.sessionId.trim() : '';
      if (!sessionId) {
        return wrapToolResult({ error: 'sessionId is required' }, true);
      }
      await deleteWorkoutSession(user.id, sessionId);
      await recordAuditLog({
        actorUserId: user.id,
        actorLabel: user.username,
        source: 'mcp',
        action: 'delete_workout_session',
        targetUserId: user.id,
        detail: { sessionId, apiKeyId, apiKeyPrefix },
      });
      return wrapToolResult({ ok: true, deletedSessionId: sessionId });
    }

    case 'delete_workout_sessions_bulk': {
      const rawSessionIds = Array.isArray(args.sessionIds)
        ? args.sessionIds.filter((s): s is string => typeof s === 'string')
        : undefined;
      const from = typeof args.from === 'string' ? args.from.trim() : undefined;
      const to = typeof args.to === 'string' ? args.to.trim() : undefined;

      const matches = await findWorkoutSessionsForBulkDelete(user.id, {
        sessionIds: rawSessionIds,
        from,
        to,
      });

      if (matches.length === 0) {
        if (
          args.confirmationToken !== undefined &&
          args.confirmationToken !== null
        ) {
          return wrapToolResult(
            {
              error:
                'Confirmation failed: token is invalid, expired, already used, or matching workout sessions no longer exist.',
            },
            true,
          );
        }
        return wrapToolResult({
          ok: true,
          deletedCount: 0,
          deletedSessionIds: [],
          message: 'No matching workout sessions found for this user.',
        });
      }

      const sortedIds = matches.map((m) => m.id).sort();
      const target =
        rawSessionIds && rawSessionIds.length > 0
          ? `ids:${sortedIds.join(',')}`
          : `range:${from ?? ''}..${to ?? ''}`;

      const gate = await requireTwoStepConfirmation({
        userId: user.id,
        apiKeyId,
        action: 'delete_workout_sessions_bulk',
        target,
        payload: {
          sessionIds: rawSessionIds ? [...rawSessionIds].sort() : undefined,
          from: from ?? null,
          to: to ?? null,
          matchedIds: sortedIds,
        },
        confirmationToken: args.confirmationToken,
        description: `Permanently delete ${matches.length} workout session(s) and their exercises, sets, and rep qualities (Apple Health links cleared).`,
        summary: {
          matchedCount: matches.length,
          sessions: matches.slice(0, 20),
        },
      });
      if (!gate.confirmed) {
        return gate.response;
      }

      const deletedCount = await deleteWorkoutSessionsBulk(user.id, sortedIds);
      await recordAuditLog({
        actorUserId: user.id,
        actorLabel: user.username,
        source: 'mcp',
        action: 'delete_workout_sessions_bulk',
        targetUserId: user.id,
        detail: {
          deletedCount,
          deletedSessionIds: sortedIds,
          apiKeyId,
          apiKeyPrefix,
        },
      });
      return wrapToolResult({
        ok: true,
        deletedCount,
        deletedSessionIds: sortedIds,
      });
    }

    case 'get_progress_and_rest': {
      const range =
        typeof args.range === 'string' ? args.range : undefined;
      const exerciseId =
        typeof args.exerciseId === 'string' ? args.exerciseId : undefined;
      const sessionLimit =
        typeof args.sessionLimit === 'number' ? args.sessionLimit : undefined;
      const report = await getUserProgressAndRestReport(user, {
        range,
        exerciseId,
        sessionLimit,
      });
      return wrapToolResult(report);
    }

    case 'manage_exercise_step': {
      const action = typeof args.action === 'string' ? args.action.trim() : '';
      if (action === 'list_overrides') {
        const overrides = await listUserExercisePrefs(user.id);
        return wrapToolResult({ count: overrides.length, overrides });
      }
      const exerciseId =
        typeof args.exerciseId === 'string' ? args.exerciseId.trim() : '';
      if (!exerciseId) {
        return wrapToolResult({ error: 'exerciseId is required' }, true);
      }

      if (action === 'get') {
        const ex = await getExerciseById(user.id, exerciseId);
        if (!ex) {
          return wrapToolResult({ error: 'Exercise not found' }, true);
        }
        const resolved = resolveDisplayWeightStep({
          userOverrideKg: ex.userWeightStepKg,
          exerciseDefaultKg: ex.weightStepKg,
          userGlobalDefaultKg: user.defaultWeightStepKg,
          unit: user.unit,
        });
        return wrapToolResult({ exercise: ex, resolvedStep: resolved });
      }

      if (action === 'set') {
        if (args.weightStepKg === undefined) {
          return wrapToolResult(
            { error: 'weightStepKg is required (number or null)' },
            true,
          );
        }
        const parsed = parseNullableWeightStepKg(args.weightStepKg);
        const updated = await setExerciseWeightStepForUser(
          user.id,
          exerciseId,
          parsed,
        );
        if (!updated) {
          return wrapToolResult({ error: 'Exercise not found' }, true);
        }
        const resolved = resolveDisplayWeightStep({
          userOverrideKg: updated.userWeightStepKg,
          exerciseDefaultKg: updated.weightStepKg,
          userGlobalDefaultKg: user.defaultWeightStepKg,
          unit: user.unit,
        });
        return wrapToolResult({ exercise: updated, resolvedStep: resolved });
      }

      if (action === 'reset') {
        const updated = await setExerciseWeightStepForUser(
          user.id,
          exerciseId,
          null,
        );
        if (!updated) {
          return wrapToolResult({ error: 'Exercise not found' }, true);
        }
        const resolved = resolveDisplayWeightStep({
          userOverrideKg: updated.userWeightStepKg,
          exerciseDefaultKg: updated.weightStepKg,
          userGlobalDefaultKg: user.defaultWeightStepKg,
          unit: user.unit,
        });
        return wrapToolResult({ exercise: updated, resolvedStep: resolved });
      }

      return wrapToolResult(
        { error: 'action must be get, set, reset, or list_overrides' },
        true,
      );
    }

    case 'list_body_weights': {
      const range =
        args.range === undefined ? '3m' : (args.range as BodyWeightRange);
      if (
        range !== '1m' &&
        range !== '3m' &&
        range !== '1y' &&
        range !== 'all'
      ) {
        return wrapToolResult(
          { error: 'range must be 1m, 3m, 1y, or all' },
          true,
        );
      }
      const from = typeof args.from === 'string' ? args.from.trim() : undefined;
      const to = typeof args.to === 'string' ? args.to.trim() : undefined;
      if (from && !isIsoDate(from)) {
        return wrapToolResult({ error: 'from must be YYYY-MM-DD' }, true);
      }
      if (to && !isIsoDate(to)) {
        return wrapToolResult({ error: 'to must be YYYY-MM-DD' }, true);
      }

      const today = localDateForTimezone(user.timezone);
      const allMetrics = await listBodyMetrics(user.id, { from, to });
      const resolvedDaily = resolveDailyBodyWeights(allMetrics);
      const fullSeries = computeMovingAverage7dSeries(resolvedDaily);
      const dailySeries =
        from || to ? fullSeries : filterResolvedPointsByRange(fullSeries, range, today);
      const summary = computeBodyWeightSummary(resolvedDaily, allMetrics.length);
      const winningIds = new Set(resolvedDaily.map((m) => m.id));

      const includeRawHistory =
        typeof args.includeRawHistory === 'boolean'
          ? args.includeRawHistory
          : true;
      const rawHistory = includeRawHistory
        ? [...allMetrics]
            .sort((a, b) => {
              const dateCmp = b.measuredOn.localeCompare(a.measuredOn);
              if (dateCmp !== 0) return dateCmp;
              return compareBodyMetricPrecedence(b, a);
            })
            .map((m) => ({
              ...m,
              isWinningForDay: winningIds.has(m.id),
            }))
        : undefined;

      return wrapToolResult({
        unit: user.unit,
        today,
        range,
        profileWeightKg: user.weightKg,
        summary,
        dailySeries,
        ...(rawHistory !== undefined ? { rawHistory } : {}),
      });
    }

    case 'manage_body_weight': {
      const action = typeof args.action === 'string' ? args.action.trim() : '';
      if (action === 'log') {
        if (
          typeof args.weightKg !== 'number' ||
          !Number.isFinite(args.weightKg) ||
          args.weightKg < BODY_WEIGHT_MIN_KG ||
          args.weightKg > BODY_WEIGHT_MAX_KG
        ) {
          return wrapToolResult(
            {
              error: `weightKg must be a number between ${BODY_WEIGHT_MIN_KG} and ${BODY_WEIGHT_MAX_KG}`,
            },
            true,
          );
        }
        let measuredOn = localDateForTimezone(user.timezone);
        if (args.measuredOn !== undefined && args.measuredOn !== null && args.measuredOn !== '') {
          if (
            typeof args.measuredOn !== 'string' ||
            !isValidBodyIsoDate(args.measuredOn.trim())
          ) {
            return wrapToolResult(
              { error: 'measuredOn must be a valid YYYY-MM-DD date' },
              true,
            );
          }
          measuredOn = args.measuredOn.trim();
        }
        const res = await upsertManualBodyMetricInTx({
          userId: user.id,
          measuredOn,
          weightKg: args.weightKg,
          source: 'manual',
        });
        return wrapToolResult(res);
      }

      if (action === 'edit') {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) {
          return wrapToolResult({ error: 'id is required for edit' }, true);
        }
        const patch: { weightKg?: number; measuredOn?: string } = {};
        if (args.weightKg !== undefined) {
          if (
            typeof args.weightKg !== 'number' ||
            !Number.isFinite(args.weightKg) ||
            args.weightKg < BODY_WEIGHT_MIN_KG ||
            args.weightKg > BODY_WEIGHT_MAX_KG
          ) {
            return wrapToolResult(
              {
                error: `weightKg must be a number between ${BODY_WEIGHT_MIN_KG} and ${BODY_WEIGHT_MAX_KG}`,
              },
              true,
            );
          }
          patch.weightKg = args.weightKg;
        }
        if (args.measuredOn !== undefined) {
          if (
            typeof args.measuredOn !== 'string' ||
            !isValidBodyIsoDate(args.measuredOn.trim())
          ) {
            return wrapToolResult(
              { error: 'measuredOn must be a valid YYYY-MM-DD date' },
              true,
            );
          }
          patch.measuredOn = args.measuredOn.trim();
        }
        if (patch.weightKg === undefined && patch.measuredOn === undefined) {
          return wrapToolResult(
            { error: 'Provide weightKg or measuredOn to edit' },
            true,
          );
        }
        const res = await updateBodyMetricEntry(user.id, id, patch);
        if (!res) {
          return wrapToolResult({ error: 'Body weight entry not found' }, true);
        }
        return wrapToolResult(res);
      }

      if (action === 'delete') {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) {
          return wrapToolResult({ error: 'id is required for delete' }, true);
        }
        const res = await deleteBodyMetricEntry(user.id, id);
        if (!res.deleted) {
          return wrapToolResult({ error: 'Body weight entry not found' }, true);
        }
        await recordAuditLog({
          actorUserId: user.id,
          actorLabel: user.username,
          source: 'mcp',
          action: 'delete_body_weight',
          targetUserId: user.id,
          detail: { entryId: id, apiKeyId, apiKeyPrefix },
        });
        return wrapToolResult(res);
      }

      return wrapToolResult({ error: 'action must be log, edit, or delete' }, true);
    }

    case 'list_photos': {
      const from = typeof args.from === 'string' ? args.from.trim() : undefined;
      const to = typeof args.to === 'string' ? args.to.trim() : undefined;
      if (from && !isIsoDate(from)) {
        return wrapToolResult({ error: 'from must be YYYY-MM-DD' }, true);
      }
      if (to && !isIsoDate(to)) {
        return wrapToolResult({ error: 'to must be YYYY-MM-DD' }, true);
      }

      let pose: ProgressPhotoPose | undefined;
      if (args.pose !== undefined) {
        if (!isValidPhotoPose(args.pose)) {
          return wrapToolResult(
            { error: 'pose must be front, side, or back' },
            true,
          );
        }
        pose = args.pose;
      }

      let limit = 50;
      if (args.limit !== undefined) {
        if (
          typeof args.limit !== 'number' ||
          !Number.isInteger(args.limit) ||
          args.limit < 1 ||
          args.limit > 300
        ) {
          return wrapToolResult(
            { error: 'limit must be an integer between 1 and 300' },
            true,
          );
        }
        limit = args.limit;
      }

      const [allPhotos, used, quotaLimit] = await Promise.all([
        listProgressPhotos(user.id, pose ? { pose } : undefined),
        countUserPhotos(user.id),
        getUserPhotoQuota(user.id),
      ]);

      const filtered = allPhotos
        .filter((p) => (!from || p.takenOn >= from) && (!to || p.takenOn <= to))
        .slice(0, limit);

      return wrapToolResult({
        quota: { used, limit: quotaLimit },
        count: filtered.length,
        photos: filtered,
      });
    }

    case 'browse_photo_thumbnails': {
      const parsed = normalizePhotoIdsList(args.photoIds);
      if (!parsed.ids) {
        return wrapToolResult({ error: parsed.error }, true);
      }

      const results: Array<{
        photo: {
          id: string;
          takenOn: string;
          pose: ProgressPhotoPose;
          weightKg: number | null;
          thumbByteSize: number;
          width: number | null;
          height: number | null;
        };
        bytes: Buffer;
      }> = [];

      for (const photoId of parsed.ids) {
        const found = await getProgressPhotoBlob(user.id, photoId, 'thumb');
        if (!found) {
          return wrapToolResult({ error: 'Photo not found' }, true);
        }
        results.push({
          photo: {
            id: found.photo.id,
            takenOn: found.photo.takenOn,
            pose: found.photo.pose,
            weightKg: found.photo.weightKg,
            thumbByteSize: found.photo.thumbByteSize,
            width: found.photo.width,
            height: found.photo.height,
          },
          bytes: found.bytes,
        });
      }

      await safeRecordEvent({
        userId: user.id,
        eventType: 'mcp_photo_thumbnails',
        detail: {
          photoIds: parsed.ids,
          count: results.length,
        },
      });

      const meta = {
        count: results.length,
        photos: results.map((r) => r.photo),
      };
      const content: McpContentBlock[] = [
        { type: 'text', text: JSON.stringify(meta, null, 2) },
        ...results.map((r) => ({
          type: 'image' as const,
          data: r.bytes.toString('base64'),
          mimeType: 'image/jpeg' as const,
        })),
      ];

      return {
        content,
        structuredContent: meta,
        isError: false,
      };
    }

    case 'get_photo_download_links': {
      if (!getPhotoDownloadSecret()) {
        return wrapToolResult(
          {
            error:
              'Photo download links are unavailable because PHOTO_DOWNLOAD_SECRET is not configured on the server.',
          },
          true,
        );
      }

      const parsed = normalizePhotoIdsList(args.photoIds);
      if (!parsed.ids) {
        return wrapToolResult({ error: parsed.error }, true);
      }

      const metas = [];
      for (const photoId of parsed.ids) {
        const meta = await getProgressPhotoMeta(user.id, photoId);
        if (!meta) {
          return wrapToolResult({ error: 'Photo not found' }, true);
        }
        metas.push(meta);
      }

      const rateCheck = consumePhotoLinkRateLimit(user.id, metas.length);
      if (!rateCheck.allowed) {
        return wrapToolResult(
          {
            error: `Photo download link rate limit exceeded. Try again in ${rateCheck.retryAfterSeconds} seconds.`,
            retryAfterSeconds: rateCheck.retryAfterSeconds,
          },
          true,
        );
      }

      const nowMs = Date.now();
      const links = metas.map((meta) => {
        const { token, expiresAt } = createSignedPhotoToken(
          user.id,
          meta.id,
          nowMs,
        );
        const { path, url } = buildSignedPhotoUrl(token, origin);
        return {
          photoId: meta.id,
          takenOn: meta.takenOn,
          pose: meta.pose,
          path,
          url,
          expiresAt,
        };
      });

      await safeRecordEvent({
        userId: user.id,
        eventType: 'mcp_photo_download_links',
        detail: {
          photoIds: parsed.ids,
          count: links.length,
        },
      });

      return wrapToolResult({
        count: links.length,
        expiresInSeconds: 300,
        rateLimitRemaining: rateCheck.remaining,
        links,
      });
    }

    case 'delete_photo': {
      const photoId =
        typeof args.photoId === 'string' ? args.photoId.trim() : '';
      if (!photoId) {
        return wrapToolResult({ error: 'photoId is required' }, true);
      }

      const meta = await getProgressPhotoMeta(user.id, photoId);
      if (!meta) {
        return wrapToolResult({ error: 'Photo not found' }, true);
      }

      const gate = await requireTwoStepConfirmation({
        userId: user.id,
        apiKeyId,
        action: 'delete_photo',
        target: photoId,
        payload: { photoId },
        confirmationToken: args.confirmationToken,
        description: `Permanently delete progress photo (${meta.takenOn}, ${meta.pose} pose, ${meta.byteSize} bytes).`,
        summary: {
          photoId: meta.id,
          takenOn: meta.takenOn,
          pose: meta.pose,
          byteSize: meta.byteSize,
        },
      });
      if (!gate.confirmed) {
        return gate.response;
      }

      const deleted = await deleteProgressPhoto(user.id, photoId);
      if (!deleted) {
        return wrapToolResult({ error: 'Photo not found' }, true);
      }
      const [used, limit] = await Promise.all([
        countUserPhotos(user.id),
        getUserPhotoQuota(user.id),
      ]);

      await recordAuditLog({
        actorUserId: user.id,
        actorLabel: user.username,
        source: 'mcp',
        action: 'delete_photo',
        targetUserId: user.id,
        detail: { photoId, apiKeyId, apiKeyPrefix },
      });

      return wrapToolResult({
        ok: true,
        deletedPhotoId: photoId,
        quota: { used, limit },
      });
    }

    case 'apple_health_tools': {
      const action = typeof args.action === 'string' ? args.action.trim() : '';
      if (action === 'status') {
        const workouts = await listAppleHealthWorkouts(user.id, 25);
        return wrapToolResult({
          enabled: user.appleFitnessEnabled,
          lastReceivedAt: user.appleHealthLastReceivedAt,
          lastReceivedKind: user.appleHealthLastReceivedKind,
          lastReceivedLinked: user.appleHealthLastReceivedLinked,
          recentWorkoutsCount: workouts.length,
        });
      }

      if (action === 'list_workouts') {
        const limit =
          typeof args.limit === 'number' && Number.isInteger(args.limit)
            ? args.limit
            : 25;
        if (limit < 1 || limit > 200) {
          return wrapToolResult(
            { error: 'limit must be an integer between 1 and 200' },
            true,
          );
        }
        const workouts = await listAppleHealthWorkouts(user.id, limit);
        return wrapToolResult({ count: workouts.length, workouts });
      }

      if (action === 'dry_run_import') {
        if (args.payload === undefined || args.payload === null) {
          return wrapToolResult({ error: 'payload is required for dry_run_import' }, true);
        }
        let dryRunBody: unknown;
        if (Array.isArray(args.payload)) {
          dryRunBody = { workouts: args.payload, dryRun: true };
        } else if (typeof args.payload === 'object') {
          dryRunBody = {
            ...(args.payload as Record<string, unknown>),
            dryRun: true,
          };
        } else {
          return wrapToolResult(
            { error: 'payload must be a JSON object or array' },
            true,
          );
        }
        const res = await ingestAppleHealthPayload(user, dryRunBody, {
          authMethod: 'api_key',
        });
        return wrapToolResult(res);
      }

      if (action === 'relink_workout') {
        const healthWorkoutId =
          typeof args.healthWorkoutId === 'string'
            ? args.healthWorkoutId.trim()
            : '';
        if (!healthWorkoutId) {
          return wrapToolResult({ error: 'healthWorkoutId is required' }, true);
        }
        if (
          args.sessionId !== undefined &&
          args.sessionId !== null &&
          typeof args.sessionId !== 'string'
        ) {
          return wrapToolResult(
            { error: 'sessionId must be a string or null' },
            true,
          );
        }
        const updated = await relinkAppleHealthWorkout(
          user.id,
          healthWorkoutId,
          args.sessionId ?? null,
        );
        return wrapToolResult({ ok: true, workout: updated });
      }

      return wrapToolResult(
        {
          error:
            'action must be status, list_workouts, dry_run_import, or relink_workout',
        },
        true,
      );
    }

    case 'restore_liftitup_backup': {
      const action =
        args.action === undefined ? 'apply' : String(args.action).trim();
      if (action !== 'validate' && action !== 'apply') {
        return wrapToolResult(
          { error: 'action must be "validate" or "apply"' },
          true,
        );
      }

      const mode: RestoreMode =
        args.mode === undefined ? 'merge' : (args.mode as RestoreMode);
      if (mode !== 'merge' && mode !== 'replace') {
        return wrapToolResult(
          { error: 'mode must be "merge" or "replace"' },
          true,
        );
      }

      let rawText = '';
      if (typeof args.rawText === 'string') {
        rawText = args.rawText;
      } else if (
        args.exportData &&
        typeof args.exportData === 'object' &&
        !Array.isArray(args.exportData)
      ) {
        rawText = JSON.stringify(args.exportData);
      } else {
        return wrapToolResult(
          { error: 'Provide rawText (string) or exportData (object)' },
          true,
        );
      }

      const exerciseResolutions =
        args.exerciseResolutions &&
        typeof args.exerciseResolutions === 'object' &&
        !Array.isArray(args.exerciseResolutions)
          ? (args.exerciseResolutions as Record<string, UnmatchedExerciseResolution>)
          : undefined;

      const validation = await validateLiftitupRestore(user, rawText, { mode });
      if (!validation.valid) {
        return wrapToolResult(validation, true);
      }

      if (action === 'validate') {
        return wrapToolResult(validation);
      }

      if (mode === 'replace') {
        const rawHash = hashConfirmationPayload({ rawText });
        const gate = await requireTwoStepConfirmation({
          userId: user.id,
          apiKeyId,
          action: 'restore_liftitup_backup',
          target: 'replace',
          payload: { mode: 'replace', rawHash, exerciseResolutions: exerciseResolutions ?? null },
          confirmationToken: args.confirmationToken,
          description:
            'Replace-mode LiftItUp restore will permanently delete all existing workout history, splits, body metrics, hidden flags, step preferences, and custom exercises before restoring the backup (progress photos and Apple Health workouts are kept).',
          summary: {
            mode: 'replace',
            preview: validation.preview,
          },
          warning:
            'Existing workout sessions, splits, body metrics, and custom exercises will be permanently replaced.',
        });
        if (!gate.confirmed) {
          return gate.response;
        }
      }

      const result = await applyLiftitupRestore(user, rawText, {
        mode,
        confirmation: mode === 'replace' ? REPLACE_CONFIRMATION_WORD : undefined,
        exerciseResolutions,
      });

      await safeRecordEvent({
        userId: user.id,
        eventType: 'file_import',
        detail: {
          source: 'mcp_liftitup_restore',
          mode,
          sessionsCreated: result.sessionsCreated,
        },
      });

      if (mode === 'replace') {
        await recordAuditLog({
          actorUserId: user.id,
          actorLabel: user.username,
          source: 'mcp',
          action: 'restore_liftitup_backup_replace',
          targetUserId: user.id,
          detail: {
            mode,
            sessionsCreated: result.sessionsCreated,
            bodyMetricsCreated: result.bodyMetricsCreated,
            apiKeyId,
            apiKeyPrefix,
          },
        });
      }

      return wrapToolResult({ ok: true, ...result });
    }

    case 'danger_zone': {
      if (!isDangerAction(args.action)) {
        return wrapToolResult(
          {
            error:
              'action must be delete_workouts, delete_body, reset_split, or delete_account',
          },
          true,
        );
      }
      const action = args.action;
      const meta = DANGER_ACTION_MAP[action];

      const gate = await requireTwoStepConfirmation({
        userId: user.id,
        apiKeyId,
        action: 'danger_zone',
        target: action,
        payload: { action },
        confirmationToken: args.confirmationToken,
        description: `${meta.title}: ${meta.description}`,
        summary: {
          removes: meta.removes,
          keeps: meta.keeps,
        },
        warning: 'This action is permanent and cannot be undone.',
      });
      if (!gate.confirmed) {
        return gate.response;
      }

      switch (action) {
        case 'delete_workouts': {
          await deleteUserWorkoutHistory(user.id);
          await recordAuditLog({
            actorUserId: user.id,
            actorLabel: user.username,
            source: 'mcp',
            action: 'danger_delete_workouts',
            targetUserId: user.id,
            detail: { apiKeyId, apiKeyPrefix },
          });
          return wrapToolResult({ ok: true, action });
        }
        case 'delete_body': {
          await deleteUserBodyData(user.id);
          const updatedUser = await getUserById(user.id);
          await recordAuditLog({
            actorUserId: user.id,
            actorLabel: user.username,
            source: 'mcp',
            action: 'danger_delete_body',
            targetUserId: user.id,
            detail: { apiKeyId, apiKeyPrefix },
          });
          return wrapToolResult({ ok: true, action, user: updatedUser });
        }
        case 'reset_split': {
          await deleteUserSplitData(user.id);
          await recordAuditLog({
            actorUserId: user.id,
            actorLabel: user.username,
            source: 'mcp',
            action: 'danger_reset_split',
            targetUserId: user.id,
            detail: { apiKeyId, apiKeyPrefix },
          });
          return wrapToolResult({ ok: true, action });
        }
        case 'delete_account': {
          await withTransaction(async () => {
            await deleteUserAccountInTx(user.id);
            await recordAuditLog({
              actorUserId: user.id,
              actorLabel: user.username,
              source: 'mcp',
              action: 'danger_delete_account',
              targetUserId: user.id,
              detail: { apiKeyId, apiKeyPrefix },
            });
          });
          return wrapToolResult({ ok: true, action, accountDeleted: true });
        }
      }
    }

    default:
      return null;
  }
}
