/**
 * LiftItUp v2 Foundation — Public API Reference
 *
 * Database (`@/lib/db`):
 * - `getDb()`: Singleton SQLite `DatabaseSync` (schema v2 + idempotent `EXERCISE_CATALOG` sync; zero real-user seeding).
 * - `withTransaction(fn)`: Runs `fn(db)` inside `BEGIN IMMEDIATE` / `COMMIT` (rolls back on throw).
 * - `closeDb()`: Closes singleton handle (tests).
 * - Users (`@/lib/db/users`): `getUserById`, `getUserByUsername`, `createUser`, `updateUserSettings`,
 *   `touchUserLastActive`, `deleteExpiredGuests`, `localDateForTimezone`, `sanitizeTimezone`.
 * - Sessions & API Keys (`@/lib/db/sessions`): `createAuthSession`, `getAuthSessionByTokenHash`,
 *   `touchAuthSession`, `deleteAuthSession`, `deleteUserAuthSessions`, `getApiKeyByUserId`,
 *   `upsertApiKey`, `getUserByApiKeyHash`, `touchApiKeyLastUsed`.
 * - Body Metrics (`@/lib/db/bodyMetrics`): `recordBodyMetric`, `listBodyMetrics`.
 * - Exercises (`@/lib/exercises/repository` & `@/lib/db/exercises`): `listExercises`, `getExerciseById`,
 *   `findExerciseByNameOrAlias`, `createCustomExercise`, `updateCustomExercise`, `deleteCustomExercise`,
 *   `setExerciseHidden`.
 * - Workouts & Schedules (`@/lib/db/workouts`): `getActiveSchedule`, `listScheduleEvents`,
 *   `listWorkoutSessions`, `getWorkoutSessionById`, `getWorkoutSessionsByDate`,
 *   `getLastPerformanceByExerciseIds`.
 *
 * Auth (`@/lib/auth`):
 * - `@/lib/auth/password`: `hashPassword` (scrypt + random salt), `verifyPassword` (`timingSafeEqual`).
 * - `@/lib/auth/session`: `requireAuth`, `optionalAuth`, `requireApiKeyAuth`, `createSessionCookieForUser`,
 *   `clearSessionCookie`, `generateRawToken`, `hashToken`, `generateApiKey`, `SESSION_COOKIE_NAME`.
 * - `@/lib/auth/sandbox`: `createGuestSandbox`, `purgeExpiredGuestsIfDue`.
 *
 * API & Logging (`@/lib/api/handler`, `@/lib/logger`):
 * - `withApiHandler(routeName, fn)`: Wraps App Router handlers with `requestId`, JSON logging, and
 *   standard `{ error: { code, message, details? }, requestId }` error payloads.
 * - `ApiError`, `parseJsonBody(req)`, `logger`.
 */

export { getDb, closeDb, withTransaction } from './connection';
export { initSchema, syncExerciseCatalog, SCHEMA_VERSION } from './schema';
export * from './users';
export * from './sessions';
export * from './bodyMetrics';
export * from './exercises';
export * from './workouts';
