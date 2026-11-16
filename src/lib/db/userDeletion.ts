import { query, withTransaction } from './connection';

export const DEFAULT_USER_WEIGHT_KG = 75;

/**
 * Deletes all workout history for `userId` in explicit child-to-parent order.
 * Must be called inside an active transaction.
 */
export async function deleteUserWorkoutHistoryInTx(userId: string): Promise<void> {
  await query(
    `
    DELETE FROM workout_set_rep_qualities
    WHERE workout_set_id IN (
      SELECT ws.id
      FROM workout_sets ws
      JOIN workout_exercises we ON we.id = ws.workout_exercise_id
      JOIN workout_sessions s ON s.id = we.session_id
      WHERE s.user_id = $1
    )
    `,
    [userId],
  );

  await query(
    `
    DELETE FROM workout_sets
    WHERE workout_exercise_id IN (
      SELECT we.id
      FROM workout_exercises we
      JOIN workout_sessions s ON s.id = we.session_id
      WHERE s.user_id = $1
    )
    `,
    [userId],
  );

  await query(
    `
    DELETE FROM workout_exercises
    WHERE session_id IN (
      SELECT id FROM workout_sessions WHERE user_id = $1
    )
    `,
    [userId],
  );

  await query(
    `
    UPDATE apple_health_workouts
    SET linked_session_id = NULL
    WHERE user_id = $1 AND linked_session_id IS NOT NULL
    `,
    [userId],
  );

  await query('DELETE FROM session_swaps WHERE user_id = $1', [userId]);
  await query('DELETE FROM workout_sessions WHERE user_id = $1', [userId]);
}

/**
 * Deletes all workout sessions, exercises, sets, rep qualities, session swaps,
 * and clears Apple Health session links for `userId` in one transaction.
 * Keeps splits, custom exercises, body data, and Apple Health workouts.
 */
export async function deleteUserWorkoutHistory(userId: string): Promise<void> {
  await withTransaction(() => deleteUserWorkoutHistoryInTx(userId));
}

/**
 * Deletes all body metrics for `userId` and resets profile weight to default (75 kg).
 * Must be called inside an active transaction.
 */
export async function deleteUserBodyDataInTx(userId: string): Promise<void> {
  await query('DELETE FROM body_metrics WHERE user_id = $1', [userId]);
  await query('UPDATE users SET weight_kg = $1 WHERE id = $2', [
    DEFAULT_USER_WEIGHT_KG,
    userId,
  ]);
}

/**
 * Deletes all body metrics for `userId` and resets `users.weight_kg` to 75
 * in one transaction. Keeps all other user data.
 */
export async function deleteUserBodyData(userId: string): Promise<void> {
  await withTransaction(() => deleteUserBodyDataInTx(userId));
}

/**
 * Deletes all schedules (active and inactive), schedule days, day exercises,
 * and schedule events for `userId` in explicit child-to-parent order, while
 * unlinking any workout sessions. Must be called inside an active transaction.
 */
export async function deleteUserSplitDataInTx(userId: string): Promise<void> {
  await query(
    `
    UPDATE workout_sessions
    SET schedule_id = NULL, schedule_day_id = NULL
    WHERE user_id = $1 AND (schedule_id IS NOT NULL OR schedule_day_id IS NOT NULL)
    `,
    [userId],
  );

  await query('DELETE FROM schedule_events WHERE user_id = $1', [userId]);

  await query(
    `
    DELETE FROM schedule_day_exercises
    WHERE schedule_day_id IN (
      SELECT sd.id
      FROM schedule_days sd
      JOIN schedules s ON s.id = sd.schedule_id
      WHERE s.user_id = $1
    )
    `,
    [userId],
  );

  await query(
    `
    DELETE FROM schedule_days
    WHERE schedule_id IN (
      SELECT id FROM schedules WHERE user_id = $1
    )
    `,
    [userId],
  );

  await query('DELETE FROM schedules WHERE user_id = $1', [userId]);
}

/**
 * Deletes all schedules (active and inactive), days, day exercises, and events
 * for `userId` in one transaction. Keeps sessions (unlinked) and exercises.
 */
export async function deleteUserSplitData(userId: string): Promise<void> {
  await withTransaction(() => deleteUserSplitDataInTx(userId));
}

/**
 * Deletes all user-owned workout history, splits, body metrics, hidden exercise flags,
 * exercise step overrides, and custom exercises in explicit child-to-parent order for
 * Replace-mode restore. Preserves `users`, `auth_sessions`, `api_keys`,
 * `apple_health_workouts` (session links already cleared by `deleteUserWorkoutHistoryInTx`),
 * and shared catalog exercises (`user_id IS NULL`).
 * Must be called inside an active transaction.
 */
export async function resetUserAccountDataForRestoreInTx(
  userId: string,
): Promise<void> {
  await deleteUserWorkoutHistoryInTx(userId);
  await deleteUserSplitDataInTx(userId);
  await deleteUserBodyDataInTx(userId);
  await query('DELETE FROM hidden_exercises WHERE user_id = $1', [userId]);
  await query('DELETE FROM user_exercise_prefs WHERE user_id = $1', [userId]);
  await query('DELETE FROM exercises WHERE user_id = $1 AND is_custom = 1', [
    userId,
  ]);
}

/**
 * Deletes all rows belonging to `userId` in explicit child-to-parent order,
 * avoiding ON DELETE RESTRICT collisions on custom exercises used in sessions
 * or splits. Never touches shared catalog exercises (`user_id IS NULL`).
 * Must be called inside an active transaction.
 */
export async function deleteUserAccountInTx(userId: string): Promise<boolean> {
  await resetUserAccountDataForRestoreInTx(userId);
  await query('DELETE FROM apple_health_workouts WHERE user_id = $1', [userId]);
  await query('DELETE FROM api_keys WHERE user_id = $1', [userId]);
  await query('DELETE FROM auth_sessions WHERE user_id = $1', [userId]);
  const res = await query('DELETE FROM users WHERE id = $1', [userId]);
  return Number(res.rowCount ?? 0) > 0;
}

/**
 * Permanently deletes an account and all user-owned data in one transaction.
 */
export async function deleteUserAccount(userId: string): Promise<boolean> {
  return withTransaction(() => deleteUserAccountInTx(userId));
}
