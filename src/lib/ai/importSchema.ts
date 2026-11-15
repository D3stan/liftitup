export const TRACKING_TYPES = [
  'weight_reps',
  'bodyweight_reps',
  'weighted_bodyweight',
  'assisted_bodyweight',
  'time',
  'weight_time',
  'distance',
  'distance_time',
] as const;

export type AiTrackingType = (typeof TRACKING_TYPES)[number];

export interface AiImportProfile {
  heightCm: number | null;
  weightKg: number;
  age: number | null;
  trainingYears: number | null;
  unit: 'kg' | 'lb';
}

export interface AiImportExercise {
  name: string;
  trackingType: AiTrackingType;
  targetSets: number;
  targetReps: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetTimeSeconds: number | null;
  targetWeightKg: number | null;
  targetDistanceM: number | null;
  restSeconds: number;
  notes: string;
}

export interface AiImportDay {
  label: string;
  isRestDay: boolean;
  exercises: AiImportExercise[];
}

export interface AiImportPayload {
  profile: AiImportProfile;
  schedule: {
    name: string;
    days: AiImportDay[];
  };
}

export interface AiValidationError {
  path: string;
  message: string;
}

export interface AiValidationResult {
  valid: boolean;
  payload: AiImportPayload | null;
  errors: AiValidationError[];
}

export interface MatchableExercise {
  id: string;
  name: string;
  trackingType: AiTrackingType;
  isCustom: boolean;
  aliases: string[];
}

export interface AiPreviewExercise extends AiImportExercise {
  matchedExerciseId: string | null;
  matchedExerciseName: string | null;
  resolvedTrackingType: AiTrackingType;
  isNewCustom: boolean;
}

export interface AiImportPreview {
  profile: AiImportProfile;
  scheduleName: string;
  days: Array<{
    label: string;
    isRestDay: boolean;
    exercises: AiPreviewExercise[];
  }>;
  newCustomExercises: Array<{
    name: string;
    trackingType: AiTrackingType;
  }>;
}

export const AI_ONBOARDING_PROMPT = `Ask me 4 quick questions first: height (cm), weight (kg), age, and years of training.
Then ask me to describe my current workout split (I may send text, voice transcript, or a screenshot).
Once I reply, return ONLY valid JSON matching this schema (no extra prose):
{
  "profile": { "heightCm": 178, "weightKg": 78, "age": 26, "trainingYears": 3, "unit": "kg" },
  "schedule": {
    "name": "My Split",
    "days": [
      {
        "label": "Push",
        "isRestDay": false,
        "exercises": [
          {
            "name": "Barbell Bench Press",
            "trackingType": "weight_reps",
            "targetSets": 3,
            "targetRepsMin": 6,
            "targetRepsMax": 8,
            "targetWeightKg": 80,
            "restSeconds": 150,
            "notes": ""
          }
        ]
      },
      { "label": "Rest", "isRestDay": true, "exercises": [] }
    ]
  }
}
Allowed trackingType values: weight_reps, bodyweight_reps, weighted_bodyweight, assisted_bodyweight, time, weight_time, distance, distance_time.
For time exercises use "targetTimeSeconds" instead of reps; for distance use "targetDistanceM".
Put days in exact rotation order (no weekday names needed).`;

export interface EditPromptInput {
  profile: {
    heightCm: number | null;
    weightKg: number;
    age: number | null;
    trainingYears: number | null;
    unit: 'kg' | 'lb';
  };
  schedule: {
    name: string;
    days: Array<{
      label: string;
      isRestDay: boolean;
      exercises: Array<{
        name: string;
        trackingType: AiTrackingType;
        targetSets: number;
        targetReps?: number | null;
        targetRepsMin?: number | null;
        targetRepsMax?: number | null;
        targetTimeSeconds?: number | null;
        targetWeightKg?: number | null;
        targetDistanceM?: number | null;
        restSeconds: number;
        notes?: string;
      }>;
    }>;
  } | null;
}

export function buildEditPlanPrompt(input: EditPromptInput): string {
  const currentJsonObj = {
    profile: input.profile,
    schedule: input.schedule ?? {
      name: 'My Split',
      days: [],
    },
  };
  const currentJson = JSON.stringify(currentJsonObj, null, 2);

  return `Here is my current LiftItUp profile and rotation split JSON:
${currentJson}

I want to modify my plan: [describe your changes here].
First show me a concise Before -> After summary of what changes, then output the complete updated JSON in the exact same schema (valid JSON block only for the code block).`;
}

export function extractJsonText(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) return '';

  // Collect fenced code blocks (` ```json ... ``` ` or ` ``` ... ``` `)
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  const fencedBlocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(trimmed)) !== null) {
    const inner = match[1].trim();
    if (inner) fencedBlocks.push(inner);
  }
  if (fencedBlocks.length > 0) {
    // Prefer the last JSON block (useful when AI writes Before -> After then final JSON block)
    return fencedBlocks[fencedBlocks.length - 1];
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function validateNumberField(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  opts: {
    min: number;
    max: number;
    integer?: boolean;
    allowNull?: boolean;
    exclusiveMin?: boolean;
  },
  errors: AiValidationError[],
): number | null {
  if (!(key in obj) || obj[key] === undefined) {
    if (opts.allowNull) return null;
    errors.push({ path, message: 'is required' });
    return null;
  }

  const val = obj[key];
  if (val === null) {
    if (opts.allowNull) return null;
    errors.push({ path, message: 'must be a number, got null' });
    return null;
  }

  if (typeof val !== 'number' || !Number.isFinite(val)) {
    errors.push({ path, message: 'must be a finite number' });
    return null;
  }

  if (opts.integer && !Number.isInteger(val)) {
    errors.push({ path, message: 'must be an integer' });
    return null;
  }

  const belowMin = opts.exclusiveMin ? val <= opts.min : val < opts.min;
  if (belowMin || val > opts.max) {
    const minOp = opts.exclusiveMin ? `> ${opts.min}` : `>= ${opts.min}`;
    errors.push({
      path,
      message: `must be ${minOp} and <= ${opts.max} (got ${val})`,
    });
    return null;
  }

  return val;
}

const REP_TYPES = new Set<AiTrackingType>([
  'weight_reps',
  'bodyweight_reps',
  'weighted_bodyweight',
  'assisted_bodyweight',
]);
const TIME_TYPES = new Set<AiTrackingType>(['time', 'weight_time']);
const DISTANCE_TYPES = new Set<AiTrackingType>(['distance', 'distance_time']);

export function validateAiImportPayload(rawText: string): AiValidationResult {
  const errors: AiValidationError[] = [];
  const extracted = extractJsonText(rawText);

  if (!extracted) {
    return {
      valid: false,
      payload: null,
      errors: [{ path: 'root', message: 'Input is empty' }],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted) as unknown;
  } catch (err) {
    return {
      valid: false,
      payload: null,
      errors: [
        {
          path: 'root',
          message: `Invalid JSON (${err instanceof Error ? err.message : 'parse error'})`,
        },
      ],
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      valid: false,
      payload: null,
      errors: [{ path: 'root', message: 'JSON root must be an object' }],
    };
  }

  // 1. Validate profile
  const rawProfile = parsed.profile;
  let validatedProfile: AiImportProfile | null = null;
  if (!isPlainObject(rawProfile)) {
    errors.push({ path: 'profile', message: 'must be an object' });
  } else {
    const heightCm =
      'heightCm' in rawProfile && rawProfile.heightCm === null
        ? null
        : validateNumberField(
            rawProfile,
            'heightCm',
            'profile.heightCm',
            { min: 100, max: 250 },
            errors,
          );
    if (!('heightCm' in rawProfile)) {
      // already reported by validateNumberField
    }

    const weightKg = validateNumberField(
      rawProfile,
      'weightKg',
      'profile.weightKg',
      { min: 25, max: 300 },
      errors,
    );

    const age =
      'age' in rawProfile && rawProfile.age === null
        ? null
        : validateNumberField(
            rawProfile,
            'age',
            'profile.age',
            { min: 12, max: 100, integer: true },
            errors,
          );

    const trainingYears =
      'trainingYears' in rawProfile && rawProfile.trainingYears === null
        ? null
        : validateNumberField(
            rawProfile,
            'trainingYears',
            'profile.trainingYears',
            { min: 0, max: 80 },
            errors,
          );

    let unit: 'kg' | 'lb' = 'kg';
    if ('unit' in rawProfile && rawProfile.unit !== undefined) {
      if (rawProfile.unit !== 'kg' && rawProfile.unit !== 'lb') {
        errors.push({
          path: 'profile.unit',
          message: 'must be "kg" or "lb"',
        });
      } else {
        unit = rawProfile.unit;
      }
    }

    if (weightKg !== null) {
      validatedProfile = {
        heightCm,
        weightKg,
        age,
        trainingYears,
        unit,
      };
    }
  }

  // 2. Validate schedule
  const rawSchedule = parsed.schedule;
  const validatedDays: AiImportDay[] = [];
  let scheduleName = '';

  if (!isPlainObject(rawSchedule)) {
    errors.push({ path: 'schedule', message: 'must be an object' });
  } else {
    if (
      typeof rawSchedule.name !== 'string' ||
      rawSchedule.name.trim().length === 0
    ) {
      errors.push({
        path: 'schedule.name',
        message: 'must be a non-empty string',
      });
    } else if (rawSchedule.name.trim().length > 100) {
      errors.push({
        path: 'schedule.name',
        message: 'must be at most 100 characters',
      });
    } else {
      scheduleName = rawSchedule.name.trim();
    }

    if (!Array.isArray(rawSchedule.days) || rawSchedule.days.length === 0) {
      errors.push({
        path: 'schedule.days',
        message: 'must be a non-empty array',
      });
    } else if (rawSchedule.days.length > 31) {
      errors.push({
        path: 'schedule.days',
        message: 'must have at most 31 days',
      });
    } else {
      rawSchedule.days.forEach((rawDay, dayIdx) => {
        const dayPath = `schedule.days[${dayIdx}]`;
        if (!isPlainObject(rawDay)) {
          errors.push({ path: dayPath, message: 'must be an object' });
          return;
        }

        let label = '';
        if (typeof rawDay.label !== 'string' || rawDay.label.trim().length === 0) {
          errors.push({
            path: `${dayPath}.label`,
            message: 'must be a non-empty string',
          });
        } else if (rawDay.label.trim().length > 80) {
          errors.push({
            path: `${dayPath}.label`,
            message: 'must be at most 80 characters',
          });
        } else {
          label = rawDay.label.trim();
        }

        let isRestDay = false;
        if (typeof rawDay.isRestDay !== 'boolean') {
          errors.push({
            path: `${dayPath}.isRestDay`,
            message: 'must be a boolean',
          });
        } else {
          isRestDay = rawDay.isRestDay;
        }

        const rawExercises = rawDay.exercises;
        const validatedExercises: AiImportExercise[] = [];

        if (isRestDay) {
          if (rawExercises !== undefined) {
            if (!Array.isArray(rawExercises)) {
              errors.push({
                path: `${dayPath}.exercises`,
                message: 'must be an array',
              });
            } else if (rawExercises.length > 0) {
              errors.push({
                path: `${dayPath}.exercises`,
                message: 'rest day must have 0 exercises',
              });
            }
          }
        } else if (!Array.isArray(rawExercises) || rawExercises.length === 0) {
          errors.push({
            path: `${dayPath}.exercises`,
            message: 'training day must have at least 1 exercise',
          });
        } else if (rawExercises.length > 30) {
          errors.push({
            path: `${dayPath}.exercises`,
            message: 'must have at most 30 exercises',
          });
        } else {
          rawExercises.forEach((rawEx, exIdx) => {
            const exPath = `${dayPath}.exercises[${exIdx}]`;
            if (!isPlainObject(rawEx)) {
              errors.push({ path: exPath, message: 'must be an object' });
              return;
            }

            let exName = '';
            if (typeof rawEx.name !== 'string' || rawEx.name.trim().length === 0) {
              errors.push({
                path: `${exPath}.name`,
                message: 'must be a non-empty string',
              });
            } else if (rawEx.name.trim().length > 120) {
              errors.push({
                path: `${exPath}.name`,
                message: 'must be at most 120 characters',
              });
            } else {
              exName = rawEx.name.trim();
            }

            let trackingType: AiTrackingType | null = null;
            if (
              typeof rawEx.trackingType !== 'string' ||
              !(TRACKING_TYPES as readonly string[]).includes(rawEx.trackingType)
            ) {
              errors.push({
                path: `${exPath}.trackingType`,
                message: `invalid value ${JSON.stringify(rawEx.trackingType)}`,
              });
            } else {
              trackingType = rawEx.trackingType as AiTrackingType;
            }

            const targetSets = validateNumberField(
              rawEx,
              'targetSets',
              `${exPath}.targetSets`,
              { min: 1, max: 20, integer: true },
              errors,
            );

            const restSeconds = validateNumberField(
              rawEx,
              'restSeconds',
              `${exPath}.restSeconds`,
              { min: 0, max: 600, integer: true },
              errors,
            );

            let notes = '';
            if ('notes' in rawEx && rawEx.notes !== undefined && rawEx.notes !== null) {
              if (typeof rawEx.notes !== 'string') {
                errors.push({
                  path: `${exPath}.notes`,
                  message: 'must be a string',
                });
              } else if (rawEx.notes.length > 500) {
                errors.push({
                  path: `${exPath}.notes`,
                  message: 'must be at most 500 characters',
                });
              } else {
                notes = rawEx.notes.trim();
              }
            }

            const targetReps = validateNumberField(
              rawEx,
              'targetReps',
              `${exPath}.targetReps`,
              { min: 1, max: 200, integer: true, allowNull: true },
              errors,
            );
            const targetRepsMin = validateNumberField(
              rawEx,
              'targetRepsMin',
              `${exPath}.targetRepsMin`,
              { min: 1, max: 200, integer: true, allowNull: true },
              errors,
            );
            const targetRepsMax = validateNumberField(
              rawEx,
              'targetRepsMax',
              `${exPath}.targetRepsMax`,
              { min: 1, max: 200, integer: true, allowNull: true },
              errors,
            );
            const targetTimeSeconds = validateNumberField(
              rawEx,
              'targetTimeSeconds',
              `${exPath}.targetTimeSeconds`,
              { min: 1, max: 86400, integer: true, allowNull: true },
              errors,
            );
            const targetWeightKg = validateNumberField(
              rawEx,
              'targetWeightKg',
              `${exPath}.targetWeightKg`,
              { min: 0, max: 1000, allowNull: true },
              errors,
            );
            const targetDistanceM = validateNumberField(
              rawEx,
              'targetDistanceM',
              `${exPath}.targetDistanceM`,
              { min: 0, max: 200000, exclusiveMin: true, allowNull: true },
              errors,
            );

            if (trackingType) {
              if (REP_TYPES.has(trackingType)) {
                const hasSingleReps = targetReps !== null;
                const hasMin = targetRepsMin !== null;
                const hasMax = targetRepsMax !== null;
                if (hasMin !== hasMax) {
                  errors.push({
                    path: `${exPath}.${hasMin ? 'targetRepsMax' : 'targetRepsMin'}`,
                    message: 'both targetRepsMin and targetRepsMax are required for a rep range',
                  });
                } else if (hasMin && hasMax && targetRepsMin! > targetRepsMax!) {
                  errors.push({
                    path: `${exPath}.targetRepsMin`,
                    message: 'targetRepsMin cannot exceed targetRepsMax',
                  });
                } else if (!hasSingleReps && !hasMin && !hasMax) {
                  // Only report missing rep target if no field-level rep errors already exist
                  const hasRepTypeErr = errors.some(
                    (e) =>
                      e.path === `${exPath}.targetReps` ||
                      e.path === `${exPath}.targetRepsMin` ||
                      e.path === `${exPath}.targetRepsMax`,
                  );
                  if (!hasRepTypeErr) {
                    errors.push({
                      path: `${exPath}.targetReps`,
                      message: `required for trackingType "${trackingType}" (or targetRepsMin/targetRepsMax)`,
                    });
                  }
                }
              } else if (TIME_TYPES.has(trackingType)) {
                if (targetTimeSeconds === null) {
                  const hasTimeErr = errors.some(
                    (e) => e.path === `${exPath}.targetTimeSeconds`,
                  );
                  if (!hasTimeErr) {
                    errors.push({
                      path: `${exPath}.targetTimeSeconds`,
                      message: `required for trackingType "${trackingType}"`,
                    });
                  }
                }
              } else if (DISTANCE_TYPES.has(trackingType)) {
                if (targetDistanceM === null) {
                  const hasDistErr = errors.some(
                    (e) => e.path === `${exPath}.targetDistanceM`,
                  );
                  if (!hasDistErr) {
                    errors.push({
                      path: `${exPath}.targetDistanceM`,
                      message: `required for trackingType "${trackingType}"`,
                    });
                  }
                }
              }
            }

            if (trackingType && targetSets !== null && restSeconds !== null && exName) {
              validatedExercises.push({
                name: exName,
                trackingType,
                targetSets,
                targetReps,
                targetRepsMin,
                targetRepsMax,
                targetTimeSeconds,
                targetWeightKg,
                targetDistanceM,
                restSeconds,
                notes,
              });
            }
          });
        }

        validatedDays.push({
          label,
          isRestDay,
          exercises: validatedExercises,
        });
      });
    }
  }

  if (errors.length > 0 || !validatedProfile) {
    return { valid: false, payload: null, errors };
  }

  return {
    valid: true,
    payload: {
      profile: validatedProfile,
      schedule: {
        name: scheduleName,
        days: validatedDays,
      },
    },
    errors: [],
  };
}

export function matchExerciseName(
  name: string,
  catalog: readonly MatchableExercise[],
): MatchableExercise | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;

  // Prefer user's custom exercises first, then exact name, then alias
  const customFirst = [...catalog].sort((a, b) =>
    a.isCustom === b.isCustom ? 0 : a.isCustom ? -1 : 1,
  );

  const exactName = customFirst.find(
    (ex) => ex.name.toLowerCase() === normalized,
  );
  if (exactName) return exactName;

  const exactAlias = customFirst.find((ex) =>
    ex.aliases.some((alias) => alias.toLowerCase() === normalized),
  );
  return exactAlias ?? null;
}

export function buildImportPreview(
  payload: AiImportPayload,
  existingExercises: readonly MatchableExercise[],
): AiImportPreview {
  const seenNewCustom = new Map<
    string,
    { name: string; trackingType: AiTrackingType }
  >();

  const days = payload.schedule.days.map((day) => ({
    label: day.label,
    isRestDay: day.isRestDay,
    exercises: day.exercises.map((ex): AiPreviewExercise => {
      const matched = matchExerciseName(ex.name, existingExercises);
      if (matched) {
        return {
          ...ex,
          matchedExerciseId: matched.id,
          matchedExerciseName: matched.name,
          resolvedTrackingType: matched.trackingType,
          isNewCustom: false,
        };
      }

      const key = ex.name.trim().toLowerCase();
      if (!seenNewCustom.has(key)) {
        seenNewCustom.set(key, {
          name: ex.name.trim(),
          trackingType: ex.trackingType,
        });
      }

      return {
        ...ex,
        matchedExerciseId: null,
        matchedExerciseName: null,
        resolvedTrackingType: seenNewCustom.get(key)!.trackingType,
        isNewCustom: true,
      };
    }),
  }));

  return {
    profile: payload.profile,
    scheduleName: payload.schedule.name,
    days,
    newCustomExercises: Array.from(seenNewCustom.values()),
  };
}
