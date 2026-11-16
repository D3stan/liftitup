/**
 * LiftItUp v2 Foundation — Public API Reference
 *
 * Database (`@/lib/db`):
 * - `query(sql, params?)`, `queryOne(sql, params?)`, `exec(sql)`: Async PostgreSQL helpers using `pg` Pool + `AsyncLocalStorage` transaction context.
 * - `withTransaction(fn)`: Runs async `fn()` inside `BEGIN` / `COMMIT` (or `SAVEPOINT` when nested; rolls back on throw).
 * - `pingDb()`: Initializes schema if needed and runs `SELECT 1`.
 * - `closeDb()`, `setTestPool(pool)`: Pool lifecycle and test injection (`pg-mem`).
 * - Users (`@/lib/db/users`): `getUserById`, `getUserByUsername`, `createUser`, `updateUserSettings`,
 *   `touchUserLastActive`, `deleteExpiredGuests`, `localDateForTimezone`, `sanitizeTimezone`.
 * - Sessions & API Keys (`@/lib/db/sessions`): `createAuthSession`, `getAuthSessionByTokenHash`,
 *   `touchAuthSession`, `deleteAuthSession`, `getApiKeyByUserId`,
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

export {
  query,
  queryOne,
  exec,
  pingDb,
  closeDb,
  withTransaction,
  setTestPool,
  type QueryResultLike,
} from './connection';
export { initSchema, syncExerciseCatalog, SCHEMA_VERSION } from './schema';
export * from './users';
export * from './sessions';
export * from './bodyMetrics';
export * from './exercises';
export * from './workouts';
