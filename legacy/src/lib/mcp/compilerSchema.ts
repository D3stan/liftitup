import type {
  AnalyticsSummary,
  ExerciseDefinition,
  MovementSlot,
  Schedule,
  ScheduleCompilePayload,
  UserProfile,
} from '@/types/domain';

export interface CanonicalExerciseMeta {
  id: string;
  name: string;
  movementSlot: MovementSlot;
  aliases: string[];
}

export const MOVEMENT_SLOT_LABELS: Record<MovementSlot, string> = {
  horizontal_press: 'Horizontal Press (Chest)',
  incline_press: 'Incline Press (Upper Chest)',
  chest_isolation: 'Chest Isolation (Fly)',
  vertical_pull: 'Vertical Pull (Lats — Pulley & Chin-ups)',
  horizontal_pull: 'Horizontal Pull (Rows & Upper Back)',
  vertical_press: 'Vertical Press (Shoulders)',
  lateral_delt: 'Lateral Delt Raise',
  rear_delt: 'Rear Delt & Upper Back',
  squat_pattern: 'Squat / Quad Compound',
  hinge_pattern: 'Hip Hinge / Hamstring & Glute',
  knee_extension: 'Knee Extension (Quads Isolation)',
  knee_flexion: 'Knee Flexion (Hamstring Curl)',
  elbow_flexion: 'Elbow Flexion (Biceps)',
  elbow_extension: 'Elbow Extension (Triceps)',
  calf_core: 'Calves & Core',
};

export const CANONICAL_EXERCISES_FALLBACK: CanonicalExerciseMeta[] = [
  // vertical_pull
  {
    id: 'lat-pulldown-pulley',
    name: 'Lat Pulldown (Wide / Pulley)',
    movementSlot: 'vertical_pull',
    aliases: ['pulley', 'lat pulldown', 'wide grip lat pulldown', 'cable pulldown', 'trazioni lat machine'],
  },
  {
    id: 'weighted-chin-up',
    name: 'Weighted Chin-up (Supinated)',
    movementSlot: 'vertical_pull',
    aliases: ['chin-up', 'chinup', 'chin ups', 'weighted chinups', 'supinated pull-up', 'trazioni supine'],
  },
  {
    id: 'weighted-pull-up',
    name: 'Weighted Pull-up (Pronated)',
    movementSlot: 'vertical_pull',
    aliases: ['pull-up', 'pullup', 'pull ups', 'weighted pullups', 'pronated pull-up', 'trazioni'],
  },
  {
    id: 'neutral-mag-pulldown',
    name: 'Neutral-Grip MAG Lat Pulldown',
    movementSlot: 'vertical_pull',
    aliases: ['mag pulldown', 'neutral grip pulldown', 'close grip pulldown', 'v-bar pulldown'],
  },
  // horizontal_press
  {
    id: 'barbell-bench-press',
    name: 'Barbell Bench Press',
    movementSlot: 'horizontal_press',
    aliases: ['bench press', 'flat bench', 'bb bench', 'panca piana'],
  },
  {
    id: 'flat-db-press',
    name: 'Flat Dumbbell Press',
    movementSlot: 'horizontal_press',
    aliases: ['db bench press', 'dumbbell bench', 'flat dumbbell bench'],
  },
  {
    id: 'machine-chest-press',
    name: 'Converging Machine Chest Press',
    movementSlot: 'horizontal_press',
    aliases: ['chest press', 'machine press', 'hammer strength chest press'],
  },
  // incline_press
  {
    id: 'incline-db-press',
    name: 'Incline Dumbbell Press (30°)',
    movementSlot: 'incline_press',
    aliases: ['incline press', 'incline dumbbell bench', 'incline db bench', 'panca inclinata manubri'],
  },
  // chest_isolation
  {
    id: 'pec-deck-fly',
    name: 'Pec Deck Machine Fly',
    movementSlot: 'chest_isolation',
    aliases: ['pec deck', 'machine fly', 'chest fly machine'],
  },
  {
    id: 'cable-fly',
    name: 'Seated / Standing Cable Chest Fly',
    movementSlot: 'chest_isolation',
    aliases: ['cable chest fly', 'cable crossover', 'croci ai cavi'],
  },
  // horizontal_pull
  {
    id: 'chest-supported-tbar-row',
    name: 'Chest-Supported T-Bar Row',
    movementSlot: 'horizontal_pull',
    aliases: ['t-bar row', 'tbar row', 'chest supported row', 'machine row'],
  },
  {
    id: 'seated-cable-row',
    name: 'Seated Cable Row',
    movementSlot: 'horizontal_pull',
    aliases: ['cable row', 'low pulley row', 'pulley basso', 'rematore cavo'],
  },
  {
    id: 'barbell-row',
    name: 'Barbell Bent-Over Row',
    movementSlot: 'horizontal_pull',
    aliases: ['pendlay row', 'bb row', 'bent over row', 'rematore bilanciere'],
  },
  // vertical_press
  {
    id: 'seated-db-shoulder-press',
    name: 'Seated Dumbbell Shoulder Press',
    movementSlot: 'vertical_press',
    aliases: ['db shoulder press', 'dumbbell overhead press', 'lento manubri'],
  },
  {
    id: 'overhead-barbell-press',
    name: 'Overhead Barbell Press (OHP)',
    movementSlot: 'vertical_press',
    aliases: ['ohp', 'military press', 'barbell shoulder press', 'lento avanti'],
  },
  // lateral_delt
  {
    id: 'cable-lateral-raise',
    name: 'Cuff / Single-Arm Cable Lateral Raise',
    movementSlot: 'lateral_delt',
    aliases: ['lateral raise cable', 'behind back cable lateral raise', 'alzate laterali cavo'],
  },
  {
    id: 'db-lateral-raise',
    name: 'Dumbbell Lateral Raise',
    movementSlot: 'lateral_delt',
    aliases: ['lateral raise', 'side lateral raise', 'alzate laterali'],
  },
  // rear_delt
  {
    id: 'reverse-pec-deck',
    name: 'Reverse Pec Deck (Rear Delt)',
    movementSlot: 'rear_delt',
    aliases: ['rear delt fly', 'reverse fly', 'rear delt machine'],
  },
  {
    id: 'face-pull',
    name: 'Rope Face Pull',
    movementSlot: 'rear_delt',
    aliases: ['cable face pull', 'face pulls'],
  },
  // squat_pattern
  {
    id: 'barbell-back-squat',
    name: 'Barbell High-Bar Back Squat',
    movementSlot: 'squat_pattern',
    aliases: ['squat', 'back squat', 'bb squat'],
  },
  {
    id: 'hack-squat',
    name: 'Machine Hack Squat',
    movementSlot: 'squat_pattern',
    aliases: ['hack squat machine', 'pendulum squat'],
  },
  {
    id: 'leg-press',
    name: '45° Sled Leg Press',
    movementSlot: 'squat_pattern',
    aliases: ['pressa', 'sled leg press', 'machine leg press'],
  },
  {
    id: 'bulgarian-split-squat',
    name: 'Dumbbell Bulgarian Split Squat',
    movementSlot: 'squat_pattern',
    aliases: ['split squat', 'bss', 'lunge'],
  },
  // hinge_pattern
  {
    id: 'romanian-deadlift',
    name: 'Barbell Romanian Deadlift (RDL)',
    movementSlot: 'hinge_pattern',
    aliases: ['rdl', 'stiff leg deadlift', 'romanian deadlifts', 'stacco rumeno'],
  },
  {
    id: 'hip-thrust',
    name: 'Barbell / Machine Hip Thrust',
    movementSlot: 'hinge_pattern',
    aliases: ['glute bridge', 'barbell hip thrust'],
  },
  // knee_extension
  {
    id: 'seated-leg-extension',
    name: 'Seated Leg Extension',
    movementSlot: 'knee_extension',
    aliases: ['leg extension', 'quad extension'],
  },
  // knee_flexion
  {
    id: 'seated-leg-curl',
    name: 'Seated Hamstring Leg Curl',
    movementSlot: 'knee_flexion',
    aliases: ['leg curl', 'hamstring curl', 'seated curl'],
  },
  {
    id: 'lying-leg-curl',
    name: 'Lying Prone Leg Curl',
    movementSlot: 'knee_flexion',
    aliases: ['prone leg curl', 'lying hamstring curl'],
  },
  // elbow_flexion
  {
    id: 'bayesian-cable-curl',
    name: 'Bayesian Behind-the-Back Cable Curl',
    movementSlot: 'elbow_flexion',
    aliases: ['bayesian curl', 'cable curl', 'behind back curl'],
  },
  {
    id: 'incline-db-curl',
    name: 'Incline Dumbbell Bicep Curl',
    movementSlot: 'elbow_flexion',
    aliases: ['incline curl', 'db curl', 'dumbbell curl'],
  },
  {
    id: 'ez-bar-preacher-curl',
    name: 'EZ-Bar Preacher Curl',
    movementSlot: 'elbow_flexion',
    aliases: ['preacher curl', 'ez bar curl', 'scott curl', 'barbell curl'],
  },
  // elbow_extension
  {
    id: 'overhead-cable-tricep-ext',
    name: 'Overhead Rope Cable Tricep Extension',
    movementSlot: 'elbow_extension',
    aliases: ['overhead tricep extension', 'katana extension', 'cable overhead tricep'],
  },
  {
    id: 'rope-tricep-pushdown',
    name: 'Rope / V-Bar Tricep Pushdown',
    movementSlot: 'elbow_extension',
    aliases: ['tricep pushdown', 'cable pushdown', 'pressdown'],
  },
  {
    id: 'weighted-dip',
    name: 'Weighted Parallel Bar Dip',
    movementSlot: 'elbow_extension',
    aliases: ['dips', 'tricep dip', 'chest dip', 'weighted dips'],
  },
  // calf_core
  {
    id: 'standing-calf-raise',
    name: 'Standing Machine Calf Raise',
    movementSlot: 'calf_core',
    aliases: ['calf raise', 'seated calf raise', 'calves'],
  },
  {
    id: 'cable-crunch',
    name: 'Kneeling Rope Cable Crunch',
    movementSlot: 'calf_core',
    aliases: ['ab crunch', 'hanging leg raise', 'abs'],
  },
];

export const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export interface CompilerSlotChange {
  slotIndex: number;
  exerciseId: string;
  exerciseName: string;
  movementSlot: MovementSlot;
  targetSets: number;
  repRange: string;
  targetRir: number;
  restSeconds: number;
  status: 'added' | 'kept' | 'swapped';
  previousExerciseName?: string;
}

export interface CompilerDayDiff {
  dayOfWeek: number;
  dayName: string;
  beforeLabel: string;
  afterLabel: string;
  isRestDayBefore: boolean;
  isRestDayAfter: boolean;
  beforeSets: number;
  afterSets: number;
  changeType: 'unchanged' | 'modified' | 'new_training' | 'new_rest';
  slotChanges: CompilerSlotChange[];
}

export interface CompilerDiffPreview {
  mode: 'schedule' | 'workout_session';
  scheduleDiff?: {
    beforeScheduleName: string;
    afterScheduleName: string;
    beforeSplitType: string;
    afterSplitType: string;
    beforeTrainingDays: number;
    afterTrainingDays: number;
    beforeWeeklySets: number;
    afterWeeklySets: number;
    dayDiffs: CompilerDayDiff[];
  };
  sessionDiff?: {
    routineLabel: string;
    durationMinutes: number;
    totalSets: number;
    uniqueExercisesCount: number;
    estimatedVolumeKg: number;
    notes?: string;
    exerciseGroups: {
      exerciseId: string;
      exerciseName: string;
      movementSlot: MovementSlot;
      setsCount: number;
      topSetSummary: string;
    }[];
  };
}

export interface ParsedAiCompilerResult {
  valid: boolean;
  payload: ScheduleCompilePayload | null;
  diff: CompilerDiffPreview | null;
  errors: string[];
  warnings: string[];
  resolutions: string[];
}

/**
 * Resolves any exercise ID or human-readable name to a canonical ExerciseDefinition or fallback metadata.
 */
export function resolveCanonicalExercise(
  rawQuery: string,
  hintSlot?: MovementSlot,
  exercises: ExerciseDefinition[] = []
): {
  id: string;
  name: string;
  movementSlot: MovementSlot;
  exactMatch: boolean;
} {
  const clean = (rawQuery || '').trim().toLowerCase();
  const slugified = clean
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // 1. Exact ID match in runtime exercises
  const exactRuntime = exercises.find(
    (e) => e.id.toLowerCase() === clean || e.id.toLowerCase() === slugified
  );
  if (exactRuntime) {
    return {
      id: exactRuntime.id,
      name: exactRuntime.name,
      movementSlot: exactRuntime.movementSlot,
      exactMatch: true,
    };
  }

  // 2. Exact ID match in fallback catalog
  const exactFallback = CANONICAL_EXERCISES_FALLBACK.find(
    (e) => e.id === clean || e.id === slugified
  );
  if (exactFallback) {
    return {
      id: exactFallback.id,
      name: exactFallback.name,
      movementSlot: exactFallback.movementSlot,
      exactMatch: true,
    };
  }

  // 3. Name or alias match in runtime exercises
  const nameRuntime = exercises.find(
    (e) =>
      e.name.toLowerCase() === clean ||
      e.name.toLowerCase().includes(clean) ||
      clean.includes(e.name.toLowerCase())
  );
  if (nameRuntime) {
    return {
      id: nameRuntime.id,
      name: nameRuntime.name,
      movementSlot: nameRuntime.movementSlot,
      exactMatch: false,
    };
  }

  // 4. Alias / substring match in fallback catalog
  const aliasFallback = CANONICAL_EXERCISES_FALLBACK.find(
    (e) =>
      e.name.toLowerCase().includes(clean) ||
      clean.includes(e.id.replace(/-/g, ' ')) ||
      e.aliases.some((a) => clean.includes(a) || a.includes(clean))
  );
  if (aliasFallback) {
    return {
      id: aliasFallback.id,
      name: aliasFallback.name,
      movementSlot: aliasFallback.movementSlot,
      exactMatch: false,
    };
  }

  // 5. Token overlap match
  const tokens = slugified.split('-').filter((t) => t.length > 2);
  let bestCandidate = CANONICAL_EXERCISES_FALLBACK[0];
  let bestScore = -1;

  for (const item of CANONICAL_EXERCISES_FALLBACK) {
    let score = 0;
    const itemTarget = `${item.id} ${item.name.toLowerCase()} ${item.aliases.join(' ')}`;
    for (const token of tokens) {
      if (itemTarget.includes(token)) score += 2;
    }
    if (hintSlot && item.movementSlot === hintSlot) {
      score += 3;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = item;
    }
  }

  return {
    id: bestCandidate.id,
    name: bestCandidate.name,
    movementSlot: bestCandidate.movementSlot,
    exactMatch: false,
  };
}

/**
 * Builds the complete System Prompt & JSON Schema for external LLMs (ChatGPT, Claude, Gemini).
 */
export function buildAiCompilerPrompt(params: {
  user: UserProfile;
  schedule: Schedule | null;
  analytics: AnalyticsSummary | null;
  exercises?: ExerciseDefinition[];
  customGoal?: string;
  targetMode?: 'schedule' | 'workout_session';
}): string {
  const {
    user,
    schedule,
    analytics,
    exercises = [],
    customGoal = '',
    targetMode = 'schedule',
  } = params;

  const catalog =
    exercises.length > 0
      ? exercises.map((e) => ({
          id: e.id,
          name: e.name,
          movementSlot: e.movementSlot,
        }))
      : CANONICAL_EXERCISES_FALLBACK.map((e) => ({
          id: e.id,
          name: e.name,
          movementSlot: e.movementSlot,
        }));

  // Group exercises by movementSlot
  const groupedSlots: Record<string, string[]> = {};
  for (const item of catalog) {
    if (!groupedSlots[item.movementSlot]) {
      groupedSlots[item.movementSlot] = [];
    }
    groupedSlots[item.movementSlot].push(`${item.id} ("${item.name}")`);
  }

  const slotCatalogLines = Object.entries(groupedSlots)
    .map(([slot, items]) => `  - ${slot}: ${items.join(', ')}`)
    .join('\n');

  const currentScheduleLines = schedule
    ? schedule.days
        .map((d) => {
          if (d.isRestDay || d.slots.length === 0) {
            return `  - Day ${d.dayOfWeek} (${d.dayName}): REST DAY`;
          }
          const slotsText = d.slots
            .map(
              (s) =>
                `${s.exerciseId} (${s.targetSets}x${s.repRangeMin}-${s.repRangeMax} @${s.targetRir}RIR)`
            )
            .join(', ');
          return `  - Day ${d.dayOfWeek} (${d.dayName}) [${d.routineLabel}]: ${slotsText}`;
        })
        .join('\n')
    : '  - No active schedule configured yet.';

  const topPrsLines =
    analytics?.recentPrs && analytics.recentPrs.length > 0
      ? analytics.recentPrs
          .slice(0, 6)
          .map(
            (pr) =>
              `  - ${pr.exerciseName} (${pr.exerciseId}): ${pr.weightKg}kg x ${pr.reps} (Effective ${pr.effectiveLoadKg}kg, e1RM ${pr.e1rmKg}kg)`
          )
          .join('\n')
      : '  - Lat Pulldown (lat-pulldown-pulley): 80kg x 8 (e1RM ~101kg)\n  - Weighted Chin-up (weighted-chin-up): BW + 12.5kg x 8 (Effective ~87kg)\n  - Barbell Bench Press (barbell-bench-press): 95kg x 7';

  const goalText =
    customGoal.trim() ||
    (targetMode === 'schedule'
      ? 'Build me a 4-day Upper/Lower science-based hypertrophy split emphasizing lats and arms, alternating weighted-chin-up on Upper A and lat-pulldown-pulley on Upper B.'
      : 'Compile a high-intensity Pull hypertrophy session focusing on lats, upper back, and biceps using my current e1RMs.');

  return `You are the LiftItUp Science-Based Hypertrophy AI Compiler.
Respond ONLY with a single valid JSON object matching the \`ScheduleCompilePayload\` schema below (no markdown prose outside the JSON block).

=== ATHLETE PROFILE & BIOMECHANICAL CONTEXT ===
- Athlete: ${user.displayName} (@${user.username})
- Bodyweight: ${user.bodyweightKg} kg (Note: \`weighted-chin-up\` and \`weighted-pull-up\` lift 0.95 * bodyweight + external belt weight; \`lat-pulldown-pulley\` uses external cable stack weight)
- Level: Lv.${user.level} (${user.rankTier} Tier) | Active Streak: ${user.currentStreak}d

=== CURRENT WEEKLY SCHEDULE (${schedule?.name || 'Default Split'}) ===
${currentScheduleLines}

=== TOP ESTIMATED 1RMs & STRENGTH BENCHMARKS ===
${topPrsLines}

=== VALID MOVEMENT SLOTS & CANONICAL EXERCISE SLUGS ===
Always use exact \`exerciseId\` slugs from this list:
${slotCatalogLines}

=== USER HYPERTROPHY REQUEST ===
"${goalText}"
Target Compile Mode: "${targetMode}"

=== REQUIRED JSON OUTPUT SCHEMA (ScheduleCompilePayload) ===
{
  "mode": "${targetMode}",
  "schedule": {
    "name": "string (e.g. '4-Day Arm & Lat Specialization')",
    "splitType": "upper_lower" | "ppl" | "arnold" | "full_body" | "custom",
    "days": [
      {
        "dayOfWeek": 0, // 0 = Monday .. 6 = Sunday (include all 7 days, marking non-lifting days with isRestDay: true)
        "routineLabel": "string (e.g. 'Upper A — Chin-up & Chest Focus' or 'Rest & Growth')",
        "isRestDay": false,
        "slots": [
          {
            "movementSlot": "vertical_pull",
            "exerciseId": "weighted-chin-up",
            "targetSets": 3,
            "repRangeMin": 6,
            "repRangeMax": 8,
            "targetRir": 1,
            "restSeconds": 150,
            "notes": "Short hypertrophy execution cue"
          }
        ]
      }
    ]
  },
  "workoutSession": {
    "routineLabel": "string (only required when mode === 'workout_session')",
    "durationMinutes": 55,
    "notes": "string",
    "sets": [
      {
        "exerciseId": "lat-pulldown-pulley",
        "setNumber": 1,
        "weightKg": 80,
        "reps": 9,
        "rir": 1
      }
    ]
  }
}`;
}

/**
 * Tolerant parser that strips markdown fences, validates sets/reps/RIR ranges,
 * fuzzy-matches exercise slugs, and builds a Before -> After diff preview.
 */
export function parseAndValidateAiPayload(
  rawText: string,
  exercises: ExerciseDefinition[] = [],
  currentSchedule: Schedule | null = null
): ParsedAiCompilerResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const resolutions: string[] = [];

  if (!rawText || !rawText.trim()) {
    return {
      valid: false,
      payload: null,
      diff: null,
      errors: ['Paste an AI JSON response or select a sample preset above.'],
      warnings: [],
      resolutions: [],
    };
  }

  // Strip ```json ... ``` fences or extract outermost JSON object
  let cleaned = rawText.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1].trim();
  } else {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
  }

  let parsedRaw: Record<string, unknown>;
  try {
    parsedRaw = JSON.parse(cleaned);
  } catch (err) {
    return {
      valid: false,
      payload: null,
      diff: null,
      errors: [
        `Invalid JSON syntax: ${
          err instanceof Error ? err.message : 'Unable to parse JSON object'
        }. Make sure all brackets and quotes are closed.`,
      ],
      warnings: [],
      resolutions: [],
    };
  }

  // Normalize shorthand payloads
  let mode: 'schedule' | 'workout_session' = 'schedule';
  if (parsedRaw.mode === 'workout_session' || parsedRaw.workoutSession || parsedRaw.sets) {
    mode = 'workout_session';
  }

  if (mode === 'schedule') {
    const rawSchedule = (parsedRaw.schedule || parsedRaw) as Record<string, unknown>;
    if (!rawSchedule || !Array.isArray(rawSchedule.days)) {
      return {
        valid: false,
        payload: null,
        diff: null,
        errors: [
          'Missing `schedule.days` array in JSON payload. Expected 1–7 day definitions.',
        ],
        warnings: [],
        resolutions: [],
      };
    }

    const name =
      typeof rawSchedule.name === 'string' && rawSchedule.name.trim()
        ? rawSchedule.name.trim()
        : 'AI Compiled Hypertrophy Split';

    const validSplits = ['upper_lower', 'ppl', 'arnold', 'full_body', 'custom'] as const;
    const rawSplit = String(rawSchedule.splitType || 'custom').toLowerCase();
    const splitType = (validSplits as readonly string[]).includes(rawSplit)
      ? (rawSplit as ScheduleCompilePayload['schedule'] extends { splitType: infer S } ? S : 'custom')
      : 'custom';

    // Map provided days by dayOfWeek (0..6)
    const dayMap = new Map<
      number,
      NonNullable<ScheduleCompilePayload['schedule']>['days'][number]
    >();

    for (let i = 0; i < rawSchedule.days.length; i++) {
      const d = rawSchedule.days[i] as Record<string, unknown>;
      const dayOfWeek =
        typeof d.dayOfWeek === 'number' && d.dayOfWeek >= 0 && d.dayOfWeek <= 6
          ? Math.floor(d.dayOfWeek)
          : i % 7;

      const rawSlots = Array.isArray(d.slots) ? d.slots : [];
      const isRestDay = Boolean(d.isRestDay) || rawSlots.length === 0;
      const routineLabel =
        typeof d.routineLabel === 'string' && d.routineLabel.trim()
          ? d.routineLabel.trim()
          : isRestDay
          ? 'Rest & Recovery'
          : `Training Day ${dayOfWeek + 1}`;

      const validatedSlots: NonNullable<
        ScheduleCompilePayload['schedule']
      >['days'][number]['slots'] = [];

      if (!isRestDay) {
        for (const s of rawSlots as Record<string, unknown>[]) {
          const rawExQuery = String(s.exerciseId || s.exerciseName || s.name || '');
          const hintSlot = s.movementSlot as MovementSlot | undefined;
          const resolved = resolveCanonicalExercise(rawExQuery, hintSlot, exercises);

          if (!resolved.exactMatch && rawExQuery) {
            resolutions.push(
              `Fuzzy-matched "${rawExQuery}" → ${resolved.name} (${resolved.id})`
            );
          }

          let targetSets = Number(s.targetSets ?? s.sets ?? 3);
          if (Number.isNaN(targetSets) || targetSets < 1) targetSets = 3;
          if (targetSets > 8) {
            warnings.push(
              `Clamped targetSets (${targetSets} → 8) on ${resolved.name}.`
            );
            targetSets = 8;
          }

          let repRangeMin = Number(s.repRangeMin ?? s.minReps ?? 6);
          let repRangeMax = Number(s.repRangeMax ?? s.maxReps ?? 10);
          if (Number.isNaN(repRangeMin) || repRangeMin < 1) repRangeMin = 6;
          if (Number.isNaN(repRangeMax) || repRangeMax < repRangeMin) {
            repRangeMax = repRangeMin + 2;
          }

          let targetRir = Number(s.targetRir ?? s.rir ?? 1);
          if (Number.isNaN(targetRir) || targetRir < 0) targetRir = 1;
          if (targetRir > 4) targetRir = 3;

          let restSeconds = Number(s.restSeconds ?? s.rest ?? 120);
          if (Number.isNaN(restSeconds) || restSeconds < 30) restSeconds = 90;
          if (restSeconds > 300) restSeconds = 240;

          validatedSlots.push({
            movementSlot: resolved.movementSlot,
            exerciseId: resolved.id,
            targetSets: Math.round(targetSets),
            repRangeMin: Math.round(repRangeMin),
            repRangeMax: Math.round(repRangeMax),
            targetRir: Math.round(targetRir),
            restSeconds: Math.round(restSeconds),
            notes: typeof s.notes === 'string' ? s.notes : undefined,
          });
        }
      }

      dayMap.set(dayOfWeek, {
        dayOfWeek,
        routineLabel,
        isRestDay,
        slots: validatedSlots,
      });
    }

    // Ensure all 7 days (0..6) exist
    const normalizedDays: NonNullable<ScheduleCompilePayload['schedule']>['days'] = [];
    for (let dow = 0; dow < 7; dow++) {
      const existing = dayMap.get(dow);
      if (existing) {
        normalizedDays.push(existing);
      } else {
        normalizedDays.push({
          dayOfWeek: dow,
          routineLabel: 'Rest Day',
          isRestDay: true,
          slots: [],
        });
      }
    }

    const normalizedPayload: ScheduleCompilePayload = {
      mode: 'schedule',
      schedule: {
        name,
        splitType,
        days: normalizedDays,
      },
    };

    // Build Before -> After Schedule Diff
    const beforeDays = currentSchedule?.days || [];
    let beforeWeeklySets = 0;
    let afterWeeklySets = 0;
    let beforeTrainingDays = 0;
    let afterTrainingDays = 0;

    const dayDiffs: CompilerDayDiff[] = normalizedDays.map((afterDay) => {
      const beforeDay = beforeDays.find((bd) => bd.dayOfWeek === afterDay.dayOfWeek);
      const isRestDayBefore = beforeDay ? beforeDay.isRestDay : true;
      const isRestDayAfter = afterDay.isRestDay;

      const beforeSets = beforeDay
        ? beforeDay.slots.reduce((sum, s) => sum + s.targetSets, 0)
        : 0;
      const afterSets = afterDay.slots.reduce((sum, s) => sum + s.targetSets, 0);

      beforeWeeklySets += beforeSets;
      afterWeeklySets += afterSets;
      if (!isRestDayBefore) beforeTrainingDays += 1;
      if (!isRestDayAfter) afterTrainingDays += 1;

      let changeType: CompilerDayDiff['changeType'] = 'unchanged';
      if (isRestDayBefore && !isRestDayAfter) {
        changeType = 'new_training';
      } else if (!isRestDayBefore && isRestDayAfter) {
        changeType = 'new_rest';
      } else if (
        beforeDay?.routineLabel !== afterDay.routineLabel ||
        beforeSets !== afterSets ||
        beforeDay?.slots.length !== afterDay.slots.length
      ) {
        changeType = 'modified';
      }

      const slotChanges: CompilerSlotChange[] = afterDay.slots.map((slot, idx) => {
        const resolved = resolveCanonicalExercise(
          slot.exerciseId,
          slot.movementSlot,
          exercises
        );
        const prevSlotSameIdx = beforeDay?.slots[idx];
        const prevSlotSameMove = beforeDay?.slots.find(
          (bs) => bs.movementSlot === resolved.movementSlot
        );

        let status: CompilerSlotChange['status'] = 'added';
        let previousExerciseName: string | undefined;

        if (
          beforeDay?.slots.some((bs) => bs.exerciseId === resolved.id)
        ) {
          status = 'kept';
        } else if (prevSlotSameMove || prevSlotSameIdx) {
          status = 'swapped';
          const prevExId = (prevSlotSameMove || prevSlotSameIdx)!.exerciseId;
          previousExerciseName = resolveCanonicalExercise(
            prevExId,
            undefined,
            exercises
          ).name;
          if (changeType === 'unchanged') changeType = 'modified';
        }

        return {
          slotIndex: idx,
          exerciseId: resolved.id,
          exerciseName: resolved.name,
          movementSlot: resolved.movementSlot,
          targetSets: slot.targetSets,
          repRange: `${slot.repRangeMin}–${slot.repRangeMax}`,
          targetRir: slot.targetRir,
          restSeconds: slot.restSeconds,
          status,
          previousExerciseName,
        };
      });

      return {
        dayOfWeek: afterDay.dayOfWeek,
        dayName: DAY_NAMES[afterDay.dayOfWeek] || `Day ${afterDay.dayOfWeek}`,
        beforeLabel: beforeDay ? beforeDay.routineLabel : 'Rest Day',
        afterLabel: afterDay.routineLabel,
        isRestDayBefore,
        isRestDayAfter,
        beforeSets,
        afterSets,
        changeType,
        slotChanges,
      };
    });

    return {
      valid: true,
      payload: normalizedPayload,
      diff: {
        mode: 'schedule',
        scheduleDiff: {
          beforeScheduleName: currentSchedule?.name || 'Previous Split',
          afterScheduleName: name,
          beforeSplitType: currentSchedule?.splitType || 'upper_lower',
          afterSplitType: splitType,
          beforeTrainingDays,
          afterTrainingDays,
          beforeWeeklySets,
          afterWeeklySets,
          dayDiffs,
        },
      },
      errors,
      warnings,
      resolutions,
    };
  }

  // mode === 'workout_session'
  const rawSession = (parsedRaw.workoutSession || parsedRaw) as Record<
    string,
    unknown
  >;
  if (!rawSession || !Array.isArray(rawSession.sets) || rawSession.sets.length === 0) {
    return {
      valid: false,
      payload: null,
      diff: null,
      errors: [
        'Missing `workoutSession.sets` array in JSON payload. Expected at least 1 logged set.',
      ],
      warnings: [],
      resolutions: [],
    };
  }

  const routineLabel =
    typeof rawSession.routineLabel === 'string' && rawSession.routineLabel.trim()
      ? rawSession.routineLabel.trim()
      : 'AI Compiled Hypertrophy Session';
  const durationMinutes = Math.max(
    10,
    Math.min(180, Number(rawSession.durationMinutes || 55))
  );

  const normalizedSets: NonNullable<
    ScheduleCompilePayload['workoutSession']
  >['sets'] = [];
  const groupMap = new Map<
    string,
    {
      exerciseId: string;
      exerciseName: string;
      movementSlot: MovementSlot;
      setsCount: number;
      bestWeight: number;
      bestReps: number;
      bestRir: number;
    }
  >();

  let estimatedVolumeKg = 0;

  for (let i = 0; i < rawSession.sets.length; i++) {
    const s = rawSession.sets[i] as Record<string, unknown>;
    const rawEx = String(s.exerciseId || s.exerciseName || '');
    const resolved = resolveCanonicalExercise(rawEx, undefined, exercises);

    if (!resolved.exactMatch && rawEx) {
      resolutions.push(
        `Fuzzy-matched "${rawEx}" → ${resolved.name} (${resolved.id})`
      );
    }

    const weightKg = Math.max(0, Number(s.weightKg ?? s.weight ?? 20));
    const reps = Math.max(1, Math.min(50, Math.round(Number(s.reps ?? 8))));
    const rir = Math.max(0, Math.min(5, Math.round(Number(s.rir ?? 1))));
    const setNumber = Number(s.setNumber ?? i + 1);

    normalizedSets.push({
      exerciseId: resolved.id,
      setNumber,
      weightKg,
      reps,
      rir,
    });

    estimatedVolumeKg += Math.max(weightKg, 40) * reps;

    const existingGroup = groupMap.get(resolved.id);
    if (!existingGroup) {
      groupMap.set(resolved.id, {
        exerciseId: resolved.id,
        exerciseName: resolved.name,
        movementSlot: resolved.movementSlot,
        setsCount: 1,
        bestWeight: weightKg,
        bestReps: reps,
        bestRir: rir,
      });
    } else {
      existingGroup.setsCount += 1;
      if (weightKg >= existingGroup.bestWeight) {
        existingGroup.bestWeight = weightKg;
        existingGroup.bestReps = reps;
        existingGroup.bestRir = rir;
      }
    }
  }

  const normalizedPayload: ScheduleCompilePayload = {
    mode: 'workout_session',
    workoutSession: {
      routineLabel,
      durationMinutes,
      notes: typeof rawSession.notes === 'string' ? rawSession.notes : undefined,
      sets: normalizedSets,
    },
  };

  return {
    valid: true,
    payload: normalizedPayload,
    diff: {
      mode: 'workout_session',
      sessionDiff: {
        routineLabel,
        durationMinutes,
        totalSets: normalizedSets.length,
        uniqueExercisesCount: groupMap.size,
        estimatedVolumeKg: Math.round(estimatedVolumeKg),
        notes: typeof rawSession.notes === 'string' ? rawSession.notes : undefined,
        exerciseGroups: Array.from(groupMap.values()).map((g) => ({
          exerciseId: g.exerciseId,
          exerciseName: g.exerciseName,
          movementSlot: g.movementSlot,
          setsCount: g.setsCount,
          topSetSummary: `${g.bestWeight}kg × ${g.bestReps} @ ${g.bestRir} RIR`,
        })),
      },
    },
    errors,
    warnings,
    resolutions,
  };
}

export interface SampleAiPayloadPreset {
  id: string;
  title: string;
  badge: string;
  description: string;
  mode: 'schedule' | 'workout_session';
  jsonString: string;
}

/**
 * 3 Ready-to-Test Sample AI JSON Payloads for 1-Tap Testing in AiRoutineCompiler.
 */
export const SAMPLE_AI_PAYLOADS: SampleAiPayloadPreset[] = [
  {
    id: 'arm-lat-specialization-4d',
    title: '4-Day Arm & Lat Specialization (Chin-ups + Pulley)',
    badge: '4-Day Upper/Lower',
    description:
      'Alternates Weighted Chin-ups (Upper A) and Wide Lat Pulldown / Pulley (Upper B) with high-frequency Bayesian curls & overhead extensions.',
    mode: 'schedule',
    jsonString: JSON.stringify(
      {
        mode: 'schedule',
        schedule: {
          name: '4-Day Arm & Lat Specialization (Chin-up + Pulley)',
          splitType: 'upper_lower',
          days: [
            {
              dayOfWeek: 0,
              routineLabel: 'Upper A — Weighted Chin-up & Chest Dominance',
              isRestDay: false,
              slots: [
                {
                  movementSlot: 'vertical_pull',
                  exerciseId: 'weighted-chin-up',
                  targetSets: 4,
                  repRangeMin: 6,
                  repRangeMax: 8,
                  targetRir: 1,
                  restSeconds: 150,
                  notes: 'Full dead-hang stretch; chin clears bar; +belt weight',
                },
                {
                  movementSlot: 'horizontal_press',
                  exerciseId: 'barbell-bench-press',
                  targetSets: 3,
                  repRangeMin: 6,
                  repRangeMax: 8,
                  targetRir: 1,
                  restSeconds: 150,
                },
                {
                  movementSlot: 'horizontal_pull',
                  exerciseId: 'chest-supported-tbar-row',
                  targetSets: 3,
                  repRangeMin: 8,
                  repRangeMax: 10,
                  targetRir: 1,
                  restSeconds: 120,
                },
                {
                  movementSlot: 'lateral_delt',
                  exerciseId: 'cable-lateral-raise',
                  targetSets: 4,
                  repRangeMin: 12,
                  repRangeMax: 15,
                  targetRir: 1,
                  restSeconds: 75,
                },
                {
                  movementSlot: 'elbow_flexion',
                  exerciseId: 'bayesian-cable-curl',
                  targetSets: 4,
                  repRangeMin: 10,
                  repRangeMax: 12,
                  targetRir: 1,
                  restSeconds: 75,
                  notes: 'Long-length stretch behind torso',
                },
                {
                  movementSlot: 'elbow_extension',
                  exerciseId: 'overhead-cable-tricep-ext',
                  targetSets: 4,
                  repRangeMin: 10,
                  repRangeMax: 12,
                  targetRir: 1,
                  restSeconds: 75,
                },
              ],
            },
            {
              dayOfWeek: 1,
              routineLabel: 'Lower A — Hack Squat & RDL + Arms Micro',
              isRestDay: false,
              slots: [
                {
                  movementSlot: 'squat_pattern',
                  exerciseId: 'hack-squat',
                  targetSets: 3,
                  repRangeMin: 6,
                  repRangeMax: 10,
                  targetRir: 1,
                  restSeconds: 150,
                },
                {
                  movementSlot: 'hinge_pattern',
                  exerciseId: 'romanian-deadlift',
                  targetSets: 3,
                  repRangeMin: 8,
                  repRangeMax: 10,
                  targetRir: 2,
                  restSeconds: 150,
                },
                {
                  movementSlot: 'knee_extension',
                  exerciseId: 'seated-leg-extension',
                  targetSets: 3,
                  repRangeMin: 10,
                  repRangeMax: 15,
                  targetRir: 1,
                  restSeconds: 90,
                },
                {
                  movementSlot: 'knee_flexion',
                  exerciseId: 'seated-leg-curl',
                  targetSets: 3,
                  repRangeMin: 10,
                  repRangeMax: 15,
                  targetRir: 1,
                  restSeconds: 90,
                },
                {
                  movementSlot: 'calf_core',
                  exerciseId: 'standing-calf-raise',
                  targetSets: 4,
                  repRangeMin: 10,
                  repRangeMax: 15,
                  targetRir: 1,
                  restSeconds: 75,
                },
              ],
            },
            {
              dayOfWeek: 2,
              routineLabel: 'Rest & Recovery',
              isRestDay: true,
              slots: [],
            },
            {
              dayOfWeek: 3,
              routineLabel: 'Upper B — Pulley Lat Width & Arm Peak',
              isRestDay: false,
              slots: [
                {
                  movementSlot: 'vertical_pull',
                  exerciseId: 'lat-pulldown-pulley',
                  targetSets: 4,
                  repRangeMin: 8,
                  repRangeMax: 12,
                  targetRir: 1,
                  restSeconds: 120,
                  notes: 'Drive elbows to hips; 1s stretch at top',
                },
                {
                  movementSlot: 'incline_press',
                  exerciseId: 'incline-db-press',
                  targetSets: 3,
                  repRangeMin: 8,
                  repRangeMax: 10,
                  targetRir: 1,
                  restSeconds: 120,
                },
                {
                  movementSlot: 'horizontal_pull',
                  exerciseId: 'seated-cable-row',
                  targetSets: 3,
                  repRangeMin: 10,
                  repRangeMax: 12,
                  targetRir: 1,
                  restSeconds: 120,
                },
                {
                  movementSlot: 'rear_delt',
                  exerciseId: 'reverse-pec-deck',
                  targetSets: 3,
                  repRangeMin: 12,
                  repRangeMax: 15,
                  targetRir: 1,
                  restSeconds: 75,
                },
                {
                  movementSlot: 'elbow_flexion',
                  exerciseId: 'ez-bar-preacher-curl',
                  targetSets: 4,
                  repRangeMin: 8,
                  repRangeMax: 12,
                  targetRir: 1,
                  restSeconds: 75,
                },
                {
                  movementSlot: 'elbow_extension',
                  exerciseId: 'rope-tricep-pushdown',
                  targetSets: 4,
                  repRangeMin: 10,
                  repRangeMax: 15,
                  targetRir: 1,
                  restSeconds: 75,
                },
              ],
            },
            {
              dayOfWeek: 4,
              routineLabel: 'Lower B — Back Squat & Hamstrings',
              isRestDay: false,
              slots: [
                {
                  movementSlot: 'squat_pattern',
                  exerciseId: 'barbell-back-squat',
                  targetSets: 3,
                  repRangeMin: 6,
                  repRangeMax: 8,
                  targetRir: 2,
                  restSeconds: 180,
                },
                {
                  movementSlot: 'hinge_pattern',
                  exerciseId: 'hip-thrust',
                  targetSets: 3,
                  repRangeMin: 8,
                  repRangeMax: 12,
                  targetRir: 1,
                  restSeconds: 120,
                },
                {
                  movementSlot: 'knee_flexion',
                  exerciseId: 'lying-leg-curl',
                  targetSets: 3,
                  repRangeMin: 10,
                  repRangeMax: 12,
                  targetRir: 1,
                  restSeconds: 90,
                },
                {
                  movementSlot: 'knee_extension',
                  exerciseId: 'seated-leg-extension',
                  targetSets: 3,
                  repRangeMin: 12,
                  repRangeMax: 15,
                  targetRir: 1,
                  restSeconds: 90,
                },
                {
                  movementSlot: 'calf_core',
                  exerciseId: 'cable-crunch',
                  targetSets: 3,
                  repRangeMin: 12,
                  repRangeMax: 15,
                  targetRir: 1,
                  restSeconds: 60,
                },
              ],
            },
            {
              dayOfWeek: 5,
              routineLabel: 'Active Recovery & Mobility',
              isRestDay: true,
              slots: [],
            },
            {
              dayOfWeek: 6,
              routineLabel: 'Rest Day',
              isRestDay: true,
              slots: [],
            },
          ],
        },
      },
      null,
      2
    ),
  },
  {
    id: 'science-hybrid-5d',
    title: '5-Day Science-Based Upper/Lower/PPL Hybrid',
    badge: '5-Day Hybrid',
    description:
      'High-MAV 5-day hypertrophy rotation hitting every muscle group 2x/week in the 12–16 set optimal sweet spot.',
    mode: 'schedule',
    jsonString: JSON.stringify(
      {
        mode: 'schedule',
        schedule: {
          name: '5-Day Science-Based Upper/Lower/PPL Hybrid',
          splitType: 'ppl',
          days: [
            {
              dayOfWeek: 0,
              routineLabel: 'Push — Chest, Side Delts & Triceps',
              isRestDay: false,
              slots: [
                {
                  movementSlot: 'horizontal_press',
                  exerciseId: 'barbell-bench-press',
                  targetSets: 3,
                  repRangeMin: 6,
                  repRangeMax: 8,
                  targetRir: 1,
                  restSeconds: 150,
                },
                {
                  movementSlot: 'incline_press',
                  exerciseId: 'incline-db-press',
                  targetSets: 3,
                  repRangeMin: 8,
                  repRangeMax: 10,
                  targetRir: 1,
                  restSeconds: 120,
                },
                {
                  movementSlot: 'chest_isolation',
                  exerciseId: 'pec-deck-fly',
                  targetSets: 3,
                  repRangeMin: 10,
                  repRangeMax: 14,
                  targetRir: 1,
                  restSeconds: 90,
                },
                {
                  movementSlot: 'lateral_delt',
                  exerciseId: 'cable-lateral-raise',
                  targetSets: 4,
                  repRangeMin: 12,
                  repRangeMax: 15,
                  targetRir: 1,
                  restSeconds: 75,
                },
                {
                  movementSlot: 'elbow_extension',
                  exerciseId: 'overhead-cable-tricep-ext',
                  targetSets: 3,
                  repRangeMin: 10,
                  repRangeMax: 12,
                  targetRir: 1,
                  restSeconds: 90,
                },
              ],
            },
            {
              dayOfWeek: 1,
              routineLabel: 'Pull — Pulley Lats, Upper Back & Biceps',
              isRestDay: false,
              slots: [
                {
                  movementSlot: 'vertical_pull',
                  exerciseId: 'lat-pulldown-pulley',
                  targetSets: 4,
                  repRangeMin: 8,
                  repRangeMax: 10,
                  targetRir: 1,
                  restSeconds: 120,
                },
                {
                  movementSlot: 'horizontal_pull',
                  exerciseId: 'chest-supported-tbar-row',
                  targetSets: 3,
                  repRangeMin: 8,
                  repRangeMax: 10,
                  targetRir: 1,
                  restSeconds: 120,
                },
                {
                  movementSlot: 'rear_delt',
                  exerciseId: 'face-pull',
                  targetSets: 3,
                  repRangeMin: 12,
                  repRangeMax: 15,
                  targetRir: 1,
                  restSeconds: 75,
                },
                {
                  movementSlot: 'elbow_flexion',
                  exerciseId: 'bayesian-cable-curl',
                  targetSets: 3,
                  repRangeMin: 10,
                  repRangeMax: 12,
                  targetRir: 1,
                  restSeconds: 75,
                },
                {
                  movementSlot: 'elbow_flexion',
                  exerciseId: 'ez-bar-preacher-curl',
                  targetSets: 3,
                  repRangeMin: 8,
                  repRangeMax: 10,
                  targetRir: 1,
                  restSeconds: 90,
                },
              ],
            },
            {
              dayOfWeek: 2,
              routineLabel: 'Legs A — Quad & Hamstring Hypertrophy',
              isRestDay: false,
              slots: [
                {
                  movementSlot: 'squat_pattern',
                  exerciseId: 'barbell-back-squat',
                  targetSets: 3,
                  repRangeMin: 6,
                  repRangeMax: 8,
                  targetRir: 2,
                  restSeconds: 180,
                },
                {
                  movementSlot: 'hinge_pattern',
                  exerciseId: 'romanian-deadlift',
                  targetSets: 3,
                  repRangeMin: 8,
                  repRangeMax: 10,
                  targetRir: 2,
                  restSeconds: 150,
                },
                {
                  movementSlot: 'knee_extension',
                  exerciseId: 'seated-leg-extension',
                  targetSets: 3,
                  repRangeMin: 12,
                  repRangeMax: 15,
                  targetRir: 1,
                  restSeconds: 90,
                },
                {
                  movementSlot: 'knee_flexion',
                  exerciseId: 'seated-leg-curl',
                  targetSets: 3,
                  repRangeMin: 10,
                  repRangeMax: 14,
                  targetRir: 1,
                  restSeconds: 90,
                },
                {
                  movementSlot: 'calf_core',
                  exerciseId: 'standing-calf-raise',
                  targetSets: 4,
                  repRangeMin: 10,
                  repRangeMax: 15,
                  targetRir: 1,
                  restSeconds: 75,
                },
              ],
            },
            {
              dayOfWeek: 3,
              routineLabel: 'Rest Day',
              isRestDay: true,
              slots: [],
            },
            {
              dayOfWeek: 4,
              routineLabel: 'Upper — Weighted Chin-up & Shoulder Focus',
              isRestDay: false,
              slots: [
                {
                  movementSlot: 'vertical_pull',
                  exerciseId: 'weighted-chin-up',
                  targetSets: 4,
                  repRangeMin: 6,
                  repRangeMax: 8,
                  targetRir: 1,
                  restSeconds: 150,
                },
                {
                  movementSlot: 'vertical_press',
                  exerciseId: 'seated-db-shoulder-press',
                  targetSets: 3,
                  repRangeMin: 8,
                  repRangeMax: 10,
                  targetRir: 1,
                  restSeconds: 120,
                },
                {
                  movementSlot: 'horizontal_press',
                  exerciseId: 'machine-chest-press',
                  targetSets: 3,
                  repRangeMin: 8,
                  repRangeMax: 12,
                  targetRir: 1,
                  restSeconds: 120,
                },
                {
                  movementSlot: 'horizontal_pull',
                  exerciseId: 'seated-cable-row',
                  targetSets: 3,
                  repRangeMin: 10,
                  repRangeMax: 12,
                  targetRir: 1,
                  restSeconds: 90,
                },
                {
                  movementSlot: 'lateral_delt',
                  exerciseId: 'db-lateral-raise',
                  targetSets: 4,
                  repRangeMin: 12,
                  repRangeMax: 15,
                  targetRir: 1,
                  restSeconds: 75,
                },
                {
                  movementSlot: 'elbow_extension',
                  exerciseId: 'rope-tricep-pushdown',
                  targetSets: 3,
                  repRangeMin: 10,
                  repRangeMax: 14,
                  targetRir: 1,
                  restSeconds: 75,
                },
              ],
            },
            {
              dayOfWeek: 5,
              routineLabel: 'Lower B — Hack Squat, Glutes & Core',
              isRestDay: false,
              slots: [
                {
                  movementSlot: 'squat_pattern',
                  exerciseId: 'hack-squat',
                  targetSets: 3,
                  repRangeMin: 8,
                  repRangeMax: 10,
                  targetRir: 1,
                  restSeconds: 150,
                },
                {
                  movementSlot: 'hinge_pattern',
                  exerciseId: 'hip-thrust',
                  targetSets: 3,
                  repRangeMin: 8,
                  repRangeMax: 12,
                  targetRir: 1,
                  restSeconds: 120,
                },
                {
                  movementSlot: 'knee_flexion',
                  exerciseId: 'lying-leg-curl',
                  targetSets: 3,
                  repRangeMin: 10,
                  repRangeMax: 12,
                  targetRir: 1,
                  restSeconds: 90,
                },
                {
                  movementSlot: 'calf_core',
                  exerciseId: 'cable-crunch',
                  targetSets: 3,
                  repRangeMin: 12,
                  repRangeMax: 15,
                  targetRir: 1,
                  restSeconds: 60,
                },
              ],
            },
            {
              dayOfWeek: 6,
              routineLabel: 'Rest Day',
              isRestDay: true,
              slots: [],
            },
          ],
        },
      },
      null,
      2
    ),
  },
  {
    id: 'sample-pull-session-log',
    title: 'Sample AI-Compiled Pull Session Log',
    badge: 'Session Log',
    description:
      'Logs a complete 14-set Pull hypertrophy session (Weighted Chin-ups + T-Bar Row + Face Pulls + Bayesian Curls) and awards XP & PRs.',
    mode: 'workout_session',
    jsonString: JSON.stringify(
      {
        mode: 'workout_session',
        workoutSession: {
          routineLabel: 'Pull A — Weighted Chin-ups & Back Thickness (AI Compiled)',
          durationMinutes: 54,
          notes:
            'Swapped Pulley to Weighted Chin-ups (+15kg belt weight). Strong lat pump and PR on top set!',
          sets: [
            {
              exerciseId: 'weighted-chin-up',
              setNumber: 1,
              weightKg: 15,
              reps: 8,
              rir: 1,
            },
            {
              exerciseId: 'weighted-chin-up',
              setNumber: 2,
              weightKg: 15,
              reps: 8,
              rir: 1,
            },
            {
              exerciseId: 'weighted-chin-up',
              setNumber: 3,
              weightKg: 12.5,
              reps: 8,
              rir: 1,
            },
            {
              exerciseId: 'chest-supported-tbar-row',
              setNumber: 1,
              weightKg: 72.5,
              reps: 10,
              rir: 1,
            },
            {
              exerciseId: 'chest-supported-tbar-row',
              setNumber: 2,
              weightKg: 72.5,
              reps: 9,
              rir: 1,
            },
            {
              exerciseId: 'chest-supported-tbar-row',
              setNumber: 3,
              weightKg: 70,
              reps: 10,
              rir: 1,
            },
            {
              exerciseId: 'reverse-pec-deck',
              setNumber: 1,
              weightKg: 55,
              reps: 14,
              rir: 1,
            },
            {
              exerciseId: 'reverse-pec-deck',
              setNumber: 2,
              weightKg: 55,
              reps: 13,
              rir: 1,
            },
            {
              exerciseId: 'bayesian-cable-curl',
              setNumber: 1,
              weightKg: 22.5,
              reps: 12,
              rir: 1,
            },
            {
              exerciseId: 'bayesian-cable-curl',
              setNumber: 2,
              weightKg: 22.5,
              reps: 11,
              rir: 1,
            },
            {
              exerciseId: 'bayesian-cable-curl',
              setNumber: 3,
              weightKg: 22.5,
              reps: 10,
              rir: 0,
            },
          ],
        },
      },
      null,
      2
    ),
  },
];
