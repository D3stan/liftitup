import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_ONBOARDING_PROMPT,
  buildEditPlanPrompt,
  buildImportPreview,
  extractJsonText,
  validateAiImportPayload,
  type MatchableExercise,
} from '../importSchema.ts';

const VALID_PLAN = {
  profile: {
    heightCm: 178,
    weightKg: 78.5,
    age: 26,
    trainingYears: 3,
    unit: 'kg',
  },
  schedule: {
    name: 'PPL + Calisthenics',
    days: [
      {
        label: 'Push',
        isRestDay: false,
        exercises: [
          {
            name: 'Barbell Bench Press',
            trackingType: 'weight_reps',
            targetSets: 3,
            targetRepsMin: 6,
            targetRepsMax: 8,
            targetWeightKg: 80,
            restSeconds: 150,
            notes: '2s pause',
          },
          {
            name: 'Weighted Dip',
            trackingType: 'weighted_bodyweight',
            targetSets: 3,
            targetReps: 8,
            targetWeightKg: 15,
            restSeconds: 120,
          },
        ],
      },
      {
        label: 'Core & Conditioning',
        isRestDay: false,
        exercises: [
          {
            name: 'L-Sit Hold',
            trackingType: 'time',
            targetSets: 3,
            targetTimeSeconds: 25,
            restSeconds: 60,
          },
          {
            name: 'Farmer Carry',
            trackingType: 'weight_time',
            targetSets: 3,
            targetTimeSeconds: 40,
            targetWeightKg: 32,
            restSeconds: 90,
          },
          {
            name: 'Sled Push',
            trackingType: 'distance',
            targetSets: 4,
            targetDistanceM: 30,
            restSeconds: 90,
          },
          {
            name: 'Rowing Erg',
            trackingType: 'distance_time',
            targetSets: 2,
            targetDistanceM: 1000,
            targetTimeSeconds: 220,
            restSeconds: 120,
          },
        ],
      },
      {
        label: 'Rest',
        isRestDay: true,
        exercises: [],
      },
    ],
  },
};

describe('validateAiImportPayload', () => {
  it('accepts valid JSON across rep, time, and distance tracking types', () => {
    const res = validateAiImportPayload(JSON.stringify(VALID_PLAN));
    assert.equal(res.valid, true);
    assert.deepEqual(res.errors, []);
    assert.ok(res.payload);
    assert.equal(res.payload.profile.weightKg, 78.5);
    assert.equal(res.payload.schedule.days.length, 3);
    assert.equal(res.payload.schedule.days[0].exercises[0].notes, '2s pause');
    assert.equal(res.payload.schedule.days[2].isRestDay, true);
  });

  it('extracts JSON from markdown code fences with Before -> After prose', () => {
    const wrapped = [
      'Before -> After:',
      '- Added Rowing Erg',
      '',
      '```json',
      JSON.stringify(VALID_PLAN, null, 2),
      '```',
    ].join('\n');

    const extracted = extractJsonText(wrapped);
    assert.ok(extracted.startsWith('{'));
    const res = validateAiImportPayload(wrapped);
    assert.equal(res.valid, true);
    assert.equal(res.errors.length, 0);
  });

  it('rejects empty input and invalid JSON syntax', () => {
    const emptyRes = validateAiImportPayload('   ');
    assert.equal(emptyRes.valid, false);
    assert.equal(emptyRes.errors[0].path, 'root');

    const badJsonRes = validateAiImportPayload('{ "profile": ');
    assert.equal(badJsonRes.valid, false);
    assert.equal(badJsonRes.errors[0].path, 'root');
    assert.match(badJsonRes.errors[0].message, /Invalid JSON/);
  });

  it('reports precise field-path errors for out-of-range profile fields', () => {
    const mutated = structuredClone(VALID_PLAN);
    mutated.profile.heightCm = 50;
    mutated.profile.weightKg = 500;
    mutated.profile.age = 8;
    mutated.profile.trainingYears = -1;
    (mutated.profile as Record<string, unknown>).unit = 'stones';

    const res = validateAiImportPayload(JSON.stringify(mutated));
    assert.equal(res.valid, false);
    const paths = res.errors.map((e) => e.path);
    assert.ok(paths.includes('profile.heightCm'));
    assert.ok(paths.includes('profile.weightKg'));
    assert.ok(paths.includes('profile.age'));
    assert.ok(paths.includes('profile.trainingYears'));
    assert.ok(paths.includes('profile.unit'));
  });

  it('reports precise field-path errors for invalid trackingType and missing targets', () => {
    const mutated = structuredClone(VALID_PLAN);
    (mutated.schedule.days[0].exercises[0] as Record<string, unknown>).trackingType =
      'reps';
    delete (mutated.schedule.days[1].exercises[0] as Record<string, unknown>)
      .targetTimeSeconds;
    delete (mutated.schedule.days[1].exercises[2] as Record<string, unknown>)
      .targetDistanceM;

    const res = validateAiImportPayload(JSON.stringify(mutated));
    assert.equal(res.valid, false);
    const byPath = new Map(res.errors.map((e) => [e.path, e.message]));
    assert.match(
      byPath.get('schedule.days[0].exercises[0].trackingType') ?? '',
      /invalid value "reps"/,
    );
    assert.ok(byPath.has('schedule.days[1].exercises[0].targetTimeSeconds'));
    assert.ok(byPath.has('schedule.days[1].exercises[2].targetDistanceM'));
  });

  it('rejects training days with 0 exercises and rest days with exercises', () => {
    const mutated = structuredClone(VALID_PLAN);
    mutated.schedule.days[0].exercises = [];
    mutated.schedule.days[2].exercises = [
      {
        name: 'Pull-Up',
        trackingType: 'bodyweight_reps',
        targetSets: 3,
        targetReps: 8,
        restSeconds: 120,
      } as never,
    ];

    const res = validateAiImportPayload(JSON.stringify(mutated));
    assert.equal(res.valid, false);
    const paths = res.errors.map((e) => e.path);
    assert.ok(paths.includes('schedule.days[0].exercises'));
    assert.ok(paths.includes('schedule.days[2].exercises'));
  });

  it('rejects inverted rep ranges (targetRepsMin > targetRepsMax)', () => {
    const mutated = structuredClone(VALID_PLAN);
    const ex = mutated.schedule.days[0].exercises[0] as Record<string, unknown>;
    ex.targetRepsMin = 12;
    ex.targetRepsMax = 6;

    const res = validateAiImportPayload(JSON.stringify(mutated));
    assert.equal(res.valid, false);
    assert.ok(
      res.errors.some((e) => e.path === 'schedule.days[0].exercises[0].targetRepsMin'),
    );
  });
});

describe('buildImportPreview & prompts', () => {
  it('matches catalog/aliases case-insensitively and deduplicates new custom exercises', () => {
    const catalog: MatchableExercise[] = [
      {
        id: 'barbell-bench-press',
        name: 'Barbell Bench Press',
        trackingType: 'weight_reps',
        isCustom: false,
        aliases: ['flat bench', 'bb bench'],
      },
    ];

    const payload = validateAiImportPayload(
      JSON.stringify({
        profile: {
          heightCm: 175,
          weightKg: 72,
          age: 24,
          trainingYears: 2,
          unit: 'kg',
        },
        schedule: {
          name: 'Custom Split',
          days: [
            {
              label: 'Day A',
              isRestDay: false,
              exercises: [
                {
                  name: 'flat bench',
                  trackingType: 'weight_reps',
                  targetSets: 3,
                  targetReps: 8,
                  restSeconds: 120,
                },
                {
                  name: 'Zercher Good Morning',
                  trackingType: 'weight_reps',
                  targetSets: 3,
                  targetRepsMin: 8,
                  targetRepsMax: 10,
                  restSeconds: 120,
                },
              ],
            },
            {
              label: 'Day B',
              isRestDay: false,
              exercises: [
                {
                  name: 'zercher good morning',
                  trackingType: 'weight_reps',
                  targetSets: 2,
                  targetReps: 10,
                  restSeconds: 120,
                },
              ],
            },
          ],
        },
      }),
    ).payload!;

    const preview = buildImportPreview(payload, catalog);
    assert.equal(preview.days[0].exercises[0].matchedExerciseId, 'barbell-bench-press');
    assert.equal(preview.days[0].exercises[0].isNewCustom, false);
    assert.equal(preview.days[0].exercises[1].isNewCustom, true);
    assert.equal(preview.days[1].exercises[0].isNewCustom, true);
    assert.equal(preview.newCustomExercises.length, 1);
    assert.equal(preview.newCustomExercises[0].name, 'Zercher Good Morning');
  });

  it('includes onboarding schema and edit prompt embeds current JSON', () => {
    assert.match(AI_ONBOARDING_PROMPT, /Ask me 4 quick questions/);
    assert.match(AI_ONBOARDING_PROMPT, /weight_reps/);

    const editPrompt = buildEditPlanPrompt({
      profile: {
        heightCm: 178,
        weightKg: 78,
        age: 26,
        trainingYears: 3,
        unit: 'kg',
      },
      schedule: {
        name: 'My Split',
        days: [{ label: 'Rest', isRestDay: true, exercises: [] }],
      },
    });
    assert.match(editPrompt, /Before -> After/);
    assert.match(editPrompt, /"name": "My Split"/);
  });
});
