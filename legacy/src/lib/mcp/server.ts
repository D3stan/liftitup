import type {
  MovementSlot,
  MuscleGroup,
  ScheduleDay,
  UserProfile,
} from '@/types/domain';
import {
  getActiveSchedule,
  getFullAnalyticsForUser,
  getPrecompiledSessionForUser,
  logWorkoutSessionWithImpact,
  swapScheduleSlotExercise,
  upsertUserSchedule,
} from '@/lib/db/queries';
import {
  EXERCISES,
  findExerciseFuzzy,
  getExerciseById,
} from '@/lib/hypertrophy/exercises';

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

export const MCP_SERVER_INFO = {
  name: 'liftitup-hypertrophy-mcp',
  version: '1.0.0',
  protocolVersion: '2024-11-05',
  description:
    'LiftItUp Science-Based Hypertrophy & Gym Schedule Tracker MCP Server (Precompiled Double-Progression, Pulley <-> Chin-up Equivalence, MEV/MAV/MRV Landmarks, 72h Recovery)',
};

export const MCP_TOOLS_DEFINITIONS = [
  {
    name: 'get_schedule',
    description:
      'Returns the athlete’s active 7-day weekly hypertrophy schedule, routine labels, movement slots, exercises, target sets, rep ranges, and RIR.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_schedule',
    description:
      'Creates or updates the athlete’s active weekly hypertrophy split, routine days, and exercise slots.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Schedule split name (e.g. "4-Day Upper/Lower Arm & Lat Specialization")',
        },
        splitType: {
          type: 'string',
          enum: ['upper_lower', 'ppl', 'arnold', 'full_body', 'custom'],
        },
        days: {
          type: 'array',
          description: 'Array of routine day definitions (0 = Monday .. 6 = Sunday)',
          items: {
            type: 'object',
            properties: {
              dayOfWeek: { type: 'number', minimum: 0, maximum: 6 },
              routineLabel: { type: 'string' },
              isRestDay: { type: 'boolean' },
              slots: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    movementSlot: { type: 'string' },
                    exerciseId: { type: 'string' },
                    targetSets: { type: 'number' },
                    repRangeMin: { type: 'number' },
                    repRangeMax: { type: 'number' },
                    targetRir: { type: 'number' },
                    restSeconds: { type: 'number' },
                    notes: { type: 'string' },
                  },
                  required: ['exerciseId'],
                },
              },
            },
            required: ['dayOfWeek'],
          },
        },
      },
      required: ['days'],
    },
  },
  {
    name: 'get_precompiled_session',
    description:
      'Runs the Smart Double-Progression Engine for a given date or dayOfWeek (0 = Mon .. 6 = Sun) and returns the precompiled workout with target weights, reps, RIR, and progression badges.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Optional ISO date YYYY-MM-DD (defaults to today)',
        },
        dayOfWeek: {
          type: 'number',
          minimum: 0,
          maximum: 6,
          description: 'Optional day of week override (0 = Monday .. 6 = Sunday)',
        },
      },
    },
  },
  {
    name: 'log_workout_session',
    description:
      'Logs a completed hypertrophy workout session with exercises and sets, automatically computing effective load, e1RM PRs, XP, level-ups, and 72h muscle fatigue.',
    inputSchema: {
      type: 'object',
      properties: {
        routineLabel: { type: 'string' },
        durationMinutes: { type: 'number' },
        notes: { type: 'string' },
        sets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              exerciseId: { type: 'string' },
              setNumber: { type: 'number' },
              weightKg: { type: 'number' },
              reps: { type: 'number' },
              rir: { type: 'number' },
            },
            required: ['exerciseId', 'weightKg', 'reps'],
          },
        },
      },
      required: ['sets'],
    },
  },
  {
    name: 'swap_exercise_variation',
    description:
      'Swaps an exercise slot to another biomechanical variation (e.g., lat-pulldown-pulley <-> weighted-chin-up) for today’s session or permanently in the schedule, returning translated target weights and bodyweight + belt load equivalence.',
    inputSchema: {
      type: 'object',
      properties: {
        fromExerciseId: { type: 'string' },
        toExerciseId: { type: 'string' },
        scheduleSlotId: { type: 'string' },
        currentWeightKg: { type: 'number' },
        targetReps: { type: 'number' },
        targetRir: { type: 'number' },
        scope: {
          type: 'string',
          enum: ['session', 'schedule'],
          description: '"session" swaps only for today; "schedule" updates the weekly split permanently.',
        },
      },
      required: ['fromExerciseId', 'toExerciseId'],
    },
  },
  {
    name: 'get_progress_analytics',
    description:
      'Returns the athlete’s weekly muscle volume vs MEV/MAV/MRV landmarks, 72-hour muscle recovery status, e1RM progression trends, PR records, and Boss Milestones.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_exercises',
    description:
      'Lists canonical exercises filterable by movementSlot, primaryMuscle, or fuzzy search query, including equivalence ratios and bodyweight factors.',
    inputSchema: {
      type: 'object',
      properties: {
        movementSlot: { type: 'string' },
        primaryMuscle: { type: 'string' },
        query: { type: 'string' },
      },
    },
  },
];

export const MCP_RESOURCES_DEFINITIONS = [
  {
    uri: 'liftitup://user/profile',
    name: 'Athlete Profile & Gamification State',
    description:
      'Current athlete profile, bodyweightKg, XP, Level, Rank Tier, Streak, and Apple Fitness integration status.',
    mimeType: 'application/json',
  },
  {
    uri: 'liftitup://schedule/active',
    name: 'Active Weekly Hypertrophy Schedule',
    description:
      'Active 7-day training split with movement slots, canonical exercises, rep ranges, and target RIR.',
    mimeType: 'application/json',
  },
  {
    uri: 'liftitup://workout/today',
    name: "Today's Precompiled Session",
    description:
      'Today’s precompiled hypertrophy workout generated by the Smart Double-Progression Engine.',
    mimeType: 'application/json',
  },
  {
    uri: 'liftitup://analytics/summary',
    name: 'Hypertrophy Volume Landmarks, 72h Recovery & PRs',
    description:
      'Complete analytics summary including MEV/MAV/MRV weekly volume landmarks, 72h muscle recovery percentages, e1RM trends, and PR records.',
    mimeType: 'application/json',
  },
];

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

/**
 * Executes a single JSON-RPC 2.0 MCP request scoped to the authenticated UserProfile.
 */
export function handleMcpJsonRpcRequest(
  user: UserProfile,
  rpc: JsonRpcRequest
): JsonRpcResponse {
  const id = rpc.id !== undefined ? rpc.id : null;
  const method = rpc.method;
  const params = (rpc.params || {}) as Record<string, unknown>;

  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_SERVER_INFO.protocolVersion,
          serverInfo: {
            name: MCP_SERVER_INFO.name,
            version: MCP_SERVER_INFO.version,
          },
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
        },
      };
    }

    if (
      method === 'notifications/initialized' ||
      method === 'initialized' ||
      method === 'ping'
    ) {
      return {
        jsonrpc: '2.0',
        id,
        result: { ok: true, timestamp: new Date().toISOString() },
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

    if (method === 'resources/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: MCP_RESOURCES_DEFINITIONS,
        },
      };
    }

    if (method === 'resources/read') {
      const uri = String(params.uri || '');
      let resourcePayload: unknown = null;

      if (uri === 'liftitup://user/profile') {
        resourcePayload = user;
      } else if (uri === 'liftitup://schedule/active') {
        resourcePayload = getActiveSchedule(user.id);
      } else if (uri === 'liftitup://workout/today') {
        resourcePayload = getPrecompiledSessionForUser(user.id);
      } else if (uri === 'liftitup://analytics/summary') {
        resourcePayload = getFullAnalyticsForUser(user.id);
      } else {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: `Unknown MCP resource URI: "${uri}". Valid URIs: ${MCP_RESOURCES_DEFINITIONS.map(
              (r) => r.uri
            ).join(', ')}`,
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        result: {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(resourcePayload, null, 2),
            },
          ],
        },
      };
    }

    if (method === 'tools/call') {
      const toolName = String(params.name || '');
      const args = (params.arguments || {}) as Record<string, unknown>;

      switch (toolName) {
        case 'get_schedule': {
          const schedule = getActiveSchedule(user.id);
          return {
            jsonrpc: '2.0',
            id,
            result: wrapToolResult({
              user: {
                id: user.id,
                username: user.username,
                bodyweightKg: user.bodyweightKg,
              },
              schedule,
            }),
          };
        }

        case 'upsert_schedule': {
          const rawDays = Array.isArray(args.days) ? args.days : [];
          const normalizedDays: ScheduleDay[] = rawDays.map(
            (d: Record<string, unknown>, idx: number) => {
              const dow =
                typeof d.dayOfWeek === 'number' ? d.dayOfWeek : idx % 7;
              const rawSlots = Array.isArray(d.slots) ? d.slots : [];
              return {
                id: `day-${dow}`,
                dayOfWeek: dow,
                dayName: String(d.dayName || `Day ${dow}`),
                routineLabel: String(
                  d.routineLabel ||
                    (d.isRestDay ? 'Rest Day' : `Training Day ${dow + 1}`)
                ),
                isRestDay: Boolean(d.isRestDay || rawSlots.length === 0),
                focusMuscles: [],
                slots: rawSlots.map(
                  (s: Record<string, unknown>, sIdx: number) => {
                    const matchedEx =
                      findExerciseFuzzy(
                        String(s.exerciseId || s.exerciseName || '')
                      ) || getExerciseById(String(s.exerciseId || ''));
                    return {
                      id: `slot-${dow}-${sIdx}`,
                      slotIndex: sIdx,
                      movementSlot: matchedEx.movementSlot,
                      exerciseId: matchedEx.id,
                      exerciseName: matchedEx.name,
                      targetSets: Number(s.targetSets) || 3,
                      repRangeMin:
                        Number(s.repRangeMin) || matchedEx.defaultRepMin,
                      repRangeMax:
                        Number(s.repRangeMax) || matchedEx.defaultRepMax,
                      targetRir:
                        s.targetRir !== undefined ? Number(s.targetRir) : 1,
                      restSeconds:
                        Number(s.restSeconds) || matchedEx.defaultRestSeconds,
                      notes: typeof s.notes === 'string' ? s.notes : '',
                    };
                  }
                ),
              };
            }
          );

          const updated = upsertUserSchedule(user.id, {
            name: typeof args.name === 'string' ? args.name : undefined,
            splitType: args.splitType as
              | 'upper_lower'
              | 'ppl'
              | 'arnold'
              | 'full_body'
              | 'custom'
              | undefined,
            days: normalizedDays,
          });

          return {
            jsonrpc: '2.0',
            id,
            result: wrapToolResult({
              message: `Updated schedule "${updated.name}" for @${user.username}`,
              schedule: updated,
            }),
          };
        }

        case 'get_precompiled_session': {
          const dayOfWeek =
            typeof args.dayOfWeek === 'number' ? args.dayOfWeek : undefined;
          const date = typeof args.date === 'string' ? args.date : undefined;
          const session = getPrecompiledSessionForUser(user.id, {
            dayOfWeek,
            date,
          });
          return {
            jsonrpc: '2.0',
            id,
            result: wrapToolResult({
              session,
            }),
          };
        }

        case 'log_workout_session': {
          const rawSets = Array.isArray(args.sets) ? args.sets : [];
          if (rawSets.length === 0) {
            return {
              jsonrpc: '2.0',
              id,
              result: wrapToolResult(
                { error: 'At least 1 set is required in `sets` array.' },
                true
              ),
            };
          }

          const mappedSets = rawSets.map(
            (s: Record<string, unknown>, idx: number) => {
              const ex =
                findExerciseFuzzy(String(s.exerciseId || '')) ||
                getExerciseById(String(s.exerciseId || ''));
              return {
                exerciseId: ex.id,
                setNumber: Number(s.setNumber) || idx + 1,
                weightKg: Number(s.weightKg) || 0,
                reps: Math.max(1, Number(s.reps) || 8),
                rir: s.rir !== undefined ? Number(s.rir) : 1,
              };
            }
          );

          const impact = logWorkoutSessionWithImpact(user.id, {
            routineLabel:
              typeof args.routineLabel === 'string'
                ? args.routineLabel
                : 'MCP Logged Hypertrophy Session',
            durationMinutes: Number(args.durationMinutes) || 50,
            notes: typeof args.notes === 'string' ? args.notes : undefined,
            sets: mappedSets,
          });

          return {
            jsonrpc: '2.0',
            id,
            result: wrapToolResult({
              message: `Workout logged! +${impact.xpEarned} XP (${impact.session.totalSets} sets, ${impact.prsUnlocked.length} PRs)`,
              impact,
            }),
          };
        }

        case 'swap_exercise_variation': {
          const fromEx =
            findExerciseFuzzy(String(args.fromExerciseId || '')) ||
            getExerciseById(String(args.fromExerciseId || 'lat-pulldown-pulley'));
          const toEx =
            findExerciseFuzzy(String(args.toExerciseId || '')) ||
            getExerciseById(String(args.toExerciseId || 'weighted-chin-up'));

          const swap = swapScheduleSlotExercise({
            userId: user.id,
            fromExerciseId: fromEx.id,
            toExerciseId: toEx.id,
            scheduleSlotId:
              typeof args.scheduleSlotId === 'string'
                ? args.scheduleSlotId
                : undefined,
            currentWeightKg:
              typeof args.currentWeightKg === 'number'
                ? args.currentWeightKg
                : undefined,
            targetReps:
              typeof args.targetReps === 'number' ? args.targetReps : undefined,
            targetRir:
              typeof args.targetRir === 'number' ? args.targetRir : undefined,
            scope: args.scope === 'schedule' ? 'schedule' : 'session',
          });

          return {
            jsonrpc: '2.0',
            id,
            result: wrapToolResult({
              swap,
            }),
          };
        }

        case 'get_progress_analytics': {
          const analytics = getFullAnalyticsForUser(user.id);
          return {
            jsonrpc: '2.0',
            id,
            result: wrapToolResult({
              analytics,
            }),
          };
        }

        case 'list_exercises': {
          const slotFilter = args.movementSlot as MovementSlot | undefined;
          const muscleFilter = args.primaryMuscle as MuscleGroup | undefined;
          const query =
            typeof args.query === 'string'
              ? args.query.trim().toLowerCase()
              : '';

          const filtered = EXERCISES.filter((ex) => {
            if (slotFilter && ex.movementSlot !== slotFilter) return false;
            if (muscleFilter && ex.primaryMuscle !== muscleFilter) return false;
            if (
              query &&
              !ex.id.toLowerCase().includes(query) &&
              !ex.name.toLowerCase().includes(query)
            ) {
              return false;
            }
            return true;
          });

          return {
            jsonrpc: '2.0',
            id,
            result: wrapToolResult({
              count: filtered.length,
              exercises: filtered,
            }),
          };
        }

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Unknown MCP tool "${toolName}". Available tools: ${MCP_TOOLS_DEFINITIONS.map(
                (t) => t.name
              ).join(', ')}`,
            },
          };
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Unsupported JSON-RPC method "${method}". Supported: initialize, ping, tools/list, tools/call, resources/list, resources/read.`,
      },
    };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message:
          err instanceof Error ? err.message : 'Internal MCP Server error',
      },
    };
  }
}
