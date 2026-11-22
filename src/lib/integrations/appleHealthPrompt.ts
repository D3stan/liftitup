export const APPLE_HEALTH_DRY_RUN_TEMPLATE = JSON.stringify(
  {
    dryRun: true,
    workouts: [
      {
        workoutType: 'Traditional Strength Training',
        startedAt: '2026-11-16T09:00:00Z',
        durationMinutes: 45,
      },
    ],
  },
  null,
  2,
);

export const APPLE_HEALTH_WORKOUT_JSON_TEMPLATE = JSON.stringify(
  {
    workouts: [
      {
        workoutType: 'Traditional Strength Training',
        startedAt: '2026-11-16T09:00:00Z',
        durationMinutes: 52,
        activeCalories: 310,
        avgHeartRate: 136,
        maxHeartRate: 168,
        bodyweightKg: 75.4,
      },
    ],
  },
  null,
  2,
);

export const APPLE_HEALTH_WEIGHT_ONLY_JSON_TEMPLATE = JSON.stringify(
  {
    workouts: [
      {
        bodyweightKg: 75.4,
        measuredOn: '2026-11-16',
      },
    ],
  },
  null,
  2,
);

export function buildAppleHealthWebhookUrl(origin?: string | null): string {
  const cleanOrigin = typeof origin === 'string' ? origin.trim().replace(/\/+$/, '') : '';
  return cleanOrigin
    ? `${cleanOrigin}/api/integrations/apple-health`
    : '/api/integrations/apple-health';
}

export function buildAppleHealthSiriPrompt(origin?: string | null): string {
  const endpointUrl = buildAppleHealthWebhookUrl(origin);

  return `Create an Apple iOS Shortcut that syncs Apple Health workouts (and optional latest bodyweight) to my LiftItUp app.

1. Setup & Authentication
- Endpoint URL: ${endpointUrl}
- HTTP Method: POST
- Headers:
  - Content-Type: application/json
  - Authorization: Bearer <MY_LIFTITUP_API_KEY>
  (Also accepted: x-api-key: <MY_LIFTITUP_API_KEY>)
- Prompt the user for their API key during Shortcut setup (using an Import Question or Ask for Input / Text variable) instead of hardcoding a secret.

2. Shortcut Trigger & Health Data Collection
- Designed to run from a Personal Automation: Workout -> Ends (Any Workout) -> Run Immediately, or manually using the latest workout sample.
- Read from Shortcut Input (or Find Health Samples -> Workouts, sort by Start Date Latest, Limit 1):
  - workoutType: Workout Activity Type / Name (string, optional; defaults to "Traditional Strength Training")
  - startedAt: Workout Start Date formatted as ISO-8601 (e.g. "2026-11-16T09:00:00Z")
  - durationMinutes: Workout Duration converted to minutes as a positive number (1 to 600)
  - activeCalories: Active Energy Burned in kcal as an integer 0 to 10000 (optional — omit if unavailable)
  - avgHeartRate: Average Heart Rate in bpm as an integer 25 to 250 (optional — omit if unavailable)
  - maxHeartRate: Max Heart Rate in bpm as an integer 25 to 250 (optional — omit if unavailable)
- Optionally run Find Health Samples -> Weight (in kg, sort by Start Date Latest, Limit 1) and include:
  - bodyweightKg: Weight in kg as a number 25 to 300 (optional — omit if unavailable)

3. Exact Valid JSON Payload Schema
Use "Get Contents of URL" with Method = POST and Request Body = JSON matching this exact structure:

Workout (+ optional bodyweight) payload:
${APPLE_HEALTH_WORKOUT_JSON_TEMPLATE}

Weight-only payload (ONLY when sending a standalone weigh-in with NO workout fields):
${APPLE_HEALTH_WEIGHT_ONLY_JSON_TEMPLATE}
For weight-only items, both "bodyweightKg" (25-300) and a date ("measuredOn" as "YYYY-MM-DD", or "date" / "startedAt" as ISO-8601) are required.

Dry-run test payload (validates API key + schema without saving data):
${APPLE_HEALTH_DRY_RUN_TEMPLATE}

4. Strict Validation Rules (Do Not Violate)
- Never invent placeholder numbers or dates (no fallback 50m duration, 350 kcal, or fake timestamps).
- Omit any optional field whose value is empty/missing rather than sending empty strings.
- If the HTTP response has an error, parse "error.message" from the JSON response and show it in a Notification; on success, show a brief confirmation notification.`;
}
