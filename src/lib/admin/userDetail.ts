import { ApiError } from '@/lib/api/handler';
import { getDbHealthStats, query, queryOne } from '@/lib/db/connection';
import { getApiKeyByUserId, listActiveAuthSessionsForUser } from '@/lib/db/sessions';
import { localDateForTimezone } from '@/lib/db/users';
import { DEFAULT_PHOTO_QUOTA } from '@/lib/photos/constants';
import {
  projectCalendar,
  type QueueDay,
  type QueueEvent,
  type QueueSession,
} from '@/lib/schedule/queue';
import {
  listEventsForUser,
  mergeActorAuditDetail,
  recordAuditLog,
  type AdminActor,
  type AdminEventRecord,
} from './events';

export interface AdminUserDetail {
  viewedAt: string;
  account: {
    id: string;
    username: string;
    displayName: string;
    createdAt: string;
    lastActiveAt: string;
    unit: 'kg' | 'lb';
    timezone: string;
    isGuest: boolean;
    isDisabled: boolean;
    mustChangePassword: boolean;
    theme: string;
    themeVariant: string;
    restClockMode: 'stopwatch' | 'countdown';
    defaultWorkoutView: 'list' | 'focus';
    photoQuotaOverride: number | null;
    effectivePhotoQuota: number;
    activeSessions: Array<{
      createdAt: string;
      expiresAt: string;
      lastSeenAt: string;
    }>;
  };
  training: {
    totalSessions: number;
    sessionsPerWeek: number;
    currentStreakDays: number;
    longestStreakDays: number;
    avgSessionDurationMinutes: number | null;
    jollySessions: number;
    swapsMade: number;
    skippedDays: number;
    postponedDays: number;
    plannedVsCompleted: {
      hasActiveSchedule: boolean;
      scheduleName: string | null;
      plannedTrainingDays: number;
      completedDays: number;
      skippedOrMissedDays: number;
      completionRatePct: number;
    };
  };
  loggingBehaviour: {
    totalSets: number;
    avgSetsPerSession: number;
    setsWithActualRest: number;
    avgActualRestSeconds: number | null;
    setsWithQualityRating: number;
    repQualitySharePct: number;
    mostUsedExercises: Array<{
      exerciseId: string;
      name: string;
      trackingType: string;
      isCustom: boolean;
      sessionCount: number;
      setCount: number;
    }>;
    customExercises: Array<{
      id: string;
      name: string;
      trackingType: string;
      equipment: string;
      category: string;
      createdAt: string;
    }>;
  };
  featuresUsed: {
    mcp: {
      hasApiKey: boolean;
      keyPrefix: string | null;
      createdAt: string | null;
      lastUsedAt: string | null;
    };
    appleHealth: {
      enabled: boolean;
      lastReceivedAt: string | null;
      lastReceivedKind: string | null;
      lastReceivedLinked: boolean | null;
      workoutCount: number;
    };
    aiImportCount: number;
    fileImportCount: number;
    exportCount: number;
    photoArchiveExportCount: number;
    focusModeUsed: boolean;
    restClockMode: 'stopwatch' | 'countdown';
    photos: {
      count: number;
      totalBytes: number;
      quota: number;
      quotaUsedPct: number;
    };
  };
  timeline: AdminEventRecord[];
}

function computeStreaks(
  sessionDatesDesc: string[],
  todayYmd: string,
): { currentStreakDays: number; longestStreakDays: number } {
  if (sessionDatesDesc.length === 0) {
    return { currentStreakDays: 0, longestStreakDays: 0 };
  }
  const uniqueAsc = Array.from(new Set(sessionDatesDesc)).sort((a, b) =>
    a.localeCompare(b),
  );

  const toDayNum = (ymd: string): number | null => {
    const ms = Date.parse(`${ymd}T00:00:00.000Z`);
    return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
  };

  let longest = 0;
  let run = 0;
  let prevDay: number | null = null;
  for (const d of uniqueAsc) {
    const num = toDayNum(d);
    if (num === null) continue;
    if (prevDay !== null && num === prevDay + 1) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
    prevDay = num;
  }

  // Current streak is active if the latest session date is today or yesterday (in user timezone)
  const todayNum = toDayNum(todayYmd);
  const lastNum = prevDay;
  let current = 0;
  if (todayNum !== null && lastNum !== null && todayNum - lastNum <= 1) {
    current = run;
  }

  return { currentStreakDays: current, longestStreakDays: longest };
}

/**
 * Loads sanitized, content-free admin user detail and writes an audit_log entry
 * (`view_user_detail`). Shared between `/admin/users/[id]`, `/api/admin/users/[id]`,
 * and Phase 11 MCP admin tools.
 */
export async function getAdminUserDetail(
  targetUserId: string,
  actor: AdminActor,
): Promise<AdminUserDetail> {
  const userRow = await queryOne<{
    id: string;
    username: string;
    display_name: string;
    unit: string;
    timezone: string;
    theme: string;
    theme_variant: string;
    rest_clock_mode: string;
    default_workout_view: string;
    photo_quota: number | null;
    is_guest: number;
    is_disabled: number;
    must_change_password: number;
    apple_fitness_enabled: number;
    apple_health_last_received_at: string | null;
    apple_health_last_received_kind: string | null;
    apple_health_last_received_linked: number | null;
    last_active_at: string;
    created_at: string;
  }>(
    `SELECT
       id, username, display_name, unit, timezone, theme, theme_variant,
       rest_clock_mode, default_workout_view, photo_quota, is_guest,
       is_disabled, must_change_password, apple_fitness_enabled,
       apple_health_last_received_at, apple_health_last_received_kind,
       apple_health_last_received_linked, last_active_at, created_at
     FROM users
     WHERE id = $1`,
    [targetUserId],
  );

  if (!userRow) {
    throw ApiError.notFound('User not found');
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // Audit every user-detail view
  await recordAuditLog({
    actorUserId: actor.actorUserId ?? null,
    actorLabel: actor.actorLabel,
    source: actor.source,
    action: 'view_user_detail',
    targetUserId: userRow.id,
    detail: mergeActorAuditDetail(actor, null),
    createdAt: nowIso,
  });

  const [
    activeSessions,
    apiKey,
    sessionStatsRow,
    sessionDatesRes,
    swapsRow,
    schedEventCountsRow,
    setStatsRow,
    mostUsedExRes,
    customExRes,
    ahCountRow,
    photoStatsRow,
    eventCountsRes,
    timeline,
    activeSchedRow,
  ] = await Promise.all([
    listActiveAuthSessionsForUser(userRow.id, nowIso),
    getApiKeyByUserId(userRow.id),
    queryOne<{
      total_sessions: number;
      jolly_sessions: number;
      avg_duration: number | null;
    }>(
      `SELECT
         COUNT(*)::int AS total_sessions,
         COALESCE(SUM(CASE WHEN is_jolly = 1 THEN 1 ELSE 0 END), 0)::int AS jolly_sessions,
         AVG(duration_minutes) AS avg_duration
       FROM workout_sessions
       WHERE user_id = $1`,
      [userRow.id],
    ),
    query<{
      id: string;
      session_date: string;
      schedule_day_id: string | null;
      is_jolly: number;
      jolly_mode: 'extra' | 'instead' | null;
      title: string;
      completed_at: string | null;
      cid: string | null;
    }>(
      `SELECT id, session_date, schedule_day_id, is_jolly, jolly_mode, title, completed_at, cid
       FROM workout_sessions
       WHERE user_id = $1
       ORDER BY session_date DESC`,
      [userRow.id],
    ),
    queryOne<{ cnt: number }>(
      'SELECT COUNT(*)::int AS cnt FROM session_swaps WHERE user_id = $1',
      [userRow.id],
    ),
    queryOne<{ skipped_cnt: number; postponed_cnt: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN event_type = 'skip' THEN 1 ELSE 0 END), 0)::int AS skipped_cnt,
         COALESCE(SUM(CASE WHEN event_type = 'postpone' THEN 1 ELSE 0 END), 0)::int AS postponed_cnt
       FROM schedule_events
       WHERE user_id = $1`,
      [userRow.id],
    ),
    queryOne<{
      total_sets: number;
      sets_with_actual_rest: number;
      avg_actual_rest: number | null;
      sets_with_quality: number;
    }>(
      `SELECT
         COUNT(wset.id)::int AS total_sets,
         COALESCE(SUM(CASE WHEN wset.actual_rest_seconds IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS sets_with_actual_rest,
         AVG(wset.actual_rest_seconds) AS avg_actual_rest,
         COALESCE(SUM(CASE WHEN wset.execution_quality_pct IS NOT NULL OR rq.workout_set_id IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS sets_with_quality
       FROM workout_sets wset
       JOIN workout_exercises we ON we.id = wset.workout_exercise_id
       JOIN workout_sessions ws ON ws.id = we.session_id
       LEFT JOIN (SELECT DISTINCT workout_set_id FROM workout_set_rep_qualities) rq ON rq.workout_set_id = wset.id
       WHERE ws.user_id = $1`,
      [userRow.id],
    ),
    query<{
      session_id: string;
      exercise_id: string;
      name: string;
      tracking_type: string;
      is_custom: number;
      set_cnt: number;
    }>(
      `SELECT
         ws.id AS session_id,
         e.id AS exercise_id,
         e.name,
         e.tracking_type,
         e.is_custom,
         COUNT(wset.id)::int AS set_cnt
       FROM workout_exercises we
       JOIN workout_sessions ws ON ws.id = we.session_id
       JOIN exercises e ON e.id = we.exercise_id
       LEFT JOIN workout_sets wset ON wset.workout_exercise_id = we.id
       WHERE ws.user_id = $1
       GROUP BY ws.id, e.id, e.name, e.tracking_type, e.is_custom`,
      [userRow.id],
    ),
    query<{
      id: string;
      name: string;
      tracking_type: string;
      equipment: string;
      category: string;
      created_at: string;
    }>(
      `SELECT id, name, tracking_type, equipment, category, created_at
       FROM exercises
       WHERE user_id = $1 AND is_custom = 1
       ORDER BY created_at DESC`,
      [userRow.id],
    ),
    queryOne<{ cnt: number }>(
      'SELECT COUNT(*)::int AS cnt FROM apple_health_workouts WHERE user_id = $1',
      [userRow.id],
    ),
    queryOne<{ cnt: number; total_bytes: string | number }>(
      `SELECT
         COUNT(*)::int AS cnt,
         COALESCE(SUM(byte_size + thumb_byte_size), 0)::bigint AS total_bytes
       FROM progress_photos
       WHERE user_id = $1`,
      [userRow.id],
    ),
    query<{ event_type: string; cnt: number }>(
      `SELECT event_type, COUNT(*)::int AS cnt
       FROM events
       WHERE user_id = $1
       GROUP BY event_type`,
      [userRow.id],
    ),
    listEventsForUser(userRow.id, 50),
    queryOne<{
      id: string;
      name: string;
      rotation_anchor_date: string;
      rotation_anchor_index: number;
    }>(
      `SELECT id, name, rotation_anchor_date, rotation_anchor_index
       FROM schedules
       WHERE user_id = $1 AND is_active = 1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userRow.id],
    ),
  ]);

  const todayYmd = localDateForTimezone(userRow.timezone, now);
  const { currentStreakDays, longestStreakDays } = computeStreaks(
    sessionDatesRes.rows.map((r) => r.session_date),
    todayYmd,
  );

  // Compute planned vs completed using existing schedule/queue logic in src/lib/schedule/queue.ts
  let plannedTrainingDays = 0;
  let completedDays = 0;
  let skippedOrMissedDays = 0;
  let completionRatePct = 0;

  if (activeSchedRow) {
    const [daysRes, schedEventsRes] = await Promise.all([
      query<{
        id: string;
        position: number;
        label: string;
        is_rest_day: number;
      }>(
        `SELECT id, position, label, is_rest_day
         FROM schedule_days
         WHERE schedule_id = $1
         ORDER BY position ASC`,
        [activeSchedRow.id],
      ),
      query<{
        id: string;
        event_date: string;
        event_type: QueueEvent['eventType'];
        shift_days: number | null;
        jolly_label: string | null;
        created_at: string;
      }>(
        `SELECT id, event_date, event_type, shift_days, jolly_label, created_at
         FROM schedule_events
         WHERE user_id = $1 AND schedule_id = $2
         ORDER BY event_date ASC, created_at ASC`,
        [userRow.id, activeSchedRow.id],
      ),
    ]);

    const queue: QueueDay[] = daysRes.rows.map((d) => ({
      id: d.id,
      position: Number(d.position),
      label: d.label,
      isRestDay: Boolean(d.is_rest_day),
    }));

    const queueEvents: QueueEvent[] = schedEventsRes.rows.map((e) => ({
      id: e.id,
      eventDate: e.event_date,
      eventType: e.event_type,
      shiftDays: e.shift_days !== null ? Number(e.shift_days) : null,
      jollyLabel: e.jolly_label,
      createdAt: e.created_at,
    }));

    const queueSessions: QueueSession[] = sessionDatesRes.rows.map((s) => ({
      id: s.id,
      sessionDate: s.session_date,
      scheduleDayId: s.schedule_day_id,
      isJolly: Boolean(s.is_jolly),
      jollyMode: s.jolly_mode,
      title: s.title,
      completedAt: s.completed_at,
      cid: s.cid,
    }));

    if (queue.length > 0 && activeSchedRow.rotation_anchor_date <= todayYmd) {
      const projected = projectCalendar({
        queue,
        anchorDate: activeSchedRow.rotation_anchor_date,
        anchorIndex: Number(activeSchedRow.rotation_anchor_index),
        events: queueEvents,
        sessions: queueSessions,
        today: todayYmd,
        rangeStart: activeSchedRow.rotation_anchor_date,
        rangeEnd: todayYmd,
      });

      for (const day of projected) {
        if (day.status === 'completed') {
          completedDays += 1;
          plannedTrainingDays += 1;
        } else if (day.status === 'skipped') {
          skippedOrMissedDays += 1;
          plannedTrainingDays += 1;
        } else if (day.status === 'jolly_instead' || day.status === 'planned') {
          plannedTrainingDays += 1;
        }
      }
      completionRatePct =
        plannedTrainingDays > 0
          ? Math.round((completedDays / plannedTrainingDays) * 1000) / 10
          : 0;
    }
  }

  const totalSessions = Number(sessionStatsRow?.total_sessions ?? 0);
  const createdMs = Date.parse(userRow.created_at);
  const weeksSinceSignup = Number.isFinite(createdMs)
    ? Math.max(1, (now.getTime() - createdMs) / (7 * 86_400_000))
    : 1;
  const sessionsPerWeek =
    Math.round((totalSessions / weeksSinceSignup) * 10) / 10;

  const totalSets = Number(setStatsRow?.total_sets ?? 0);
  const setsWithActualRest = Number(setStatsRow?.sets_with_actual_rest ?? 0);
  const setsWithQualityRating = Number(setStatsRow?.sets_with_quality ?? 0);

  const eventCountMap = new Map(
    eventCountsRes.rows.map((r) => [r.event_type, Number(r.cnt)]),
  );

  const photoCount = Number(photoStatsRow?.cnt ?? 0);
  const photoBytes = Number(photoStatsRow?.total_bytes ?? 0);
  const photoQuotaOverride =
    userRow.photo_quota !== null && userRow.photo_quota !== undefined
      ? Number(userRow.photo_quota)
      : null;
  const effectivePhotoQuota =
    photoQuotaOverride !== null && Number.isFinite(photoQuotaOverride)
      ? Math.max(0, Math.floor(photoQuotaOverride))
      : DEFAULT_PHOTO_QUOTA;

  const focusEventCount =
    (eventCountMap.get('focus_mode_used') ?? 0) +
    (timeline.some(
      (e) =>
        e.eventType === 'workout_view_mode_changed' &&
        e.detail?.defaultWorkoutView === 'focus',
    )
      ? 1
      : 0);

  // Touch unused import guard for db health if needed elsewhere
  void getDbHealthStats;

  return {
    viewedAt: nowIso,
    account: {
      id: userRow.id,
      username: userRow.username,
      displayName: userRow.display_name,
      createdAt: userRow.created_at,
      lastActiveAt: userRow.last_active_at,
      unit: userRow.unit === 'lb' ? 'lb' : 'kg',
      timezone: userRow.timezone,
      isGuest: Boolean(userRow.is_guest),
      isDisabled: Boolean(userRow.is_disabled),
      mustChangePassword: Boolean(userRow.must_change_password),
      theme: userRow.theme,
      themeVariant: userRow.theme_variant,
      restClockMode:
        userRow.rest_clock_mode === 'countdown' ? 'countdown' : 'stopwatch',
      defaultWorkoutView:
        userRow.default_workout_view === 'focus' ? 'focus' : 'list',
      photoQuotaOverride,
      effectivePhotoQuota,
      activeSessions,
    },
    training: {
      totalSessions,
      sessionsPerWeek,
      currentStreakDays,
      longestStreakDays,
      avgSessionDurationMinutes:
        sessionStatsRow?.avg_duration !== null &&
        sessionStatsRow?.avg_duration !== undefined
          ? Math.round(Number(sessionStatsRow.avg_duration) * 10) / 10
          : null,
      jollySessions: Number(sessionStatsRow?.jolly_sessions ?? 0),
      swapsMade: Number(swapsRow?.cnt ?? 0),
      skippedDays: Number(schedEventCountsRow?.skipped_cnt ?? 0),
      postponedDays: Number(schedEventCountsRow?.postponed_cnt ?? 0),
      plannedVsCompleted: {
        hasActiveSchedule: Boolean(activeSchedRow),
        scheduleName: activeSchedRow?.name ?? null,
        plannedTrainingDays,
        completedDays,
        skippedOrMissedDays,
        completionRatePct,
      },
    },
    loggingBehaviour: {
      totalSets,
      avgSetsPerSession:
        totalSessions > 0
          ? Math.round((totalSets / totalSessions) * 10) / 10
          : 0,
      setsWithActualRest,
      avgActualRestSeconds:
        setStatsRow?.avg_actual_rest !== null &&
        setStatsRow?.avg_actual_rest !== undefined
          ? Math.round(Number(setStatsRow.avg_actual_rest) * 10) / 10
          : null,
      setsWithQualityRating,
      repQualitySharePct:
        totalSets > 0
          ? Math.round((setsWithQualityRating / totalSets) * 1000) / 10
          : 0,
      mostUsedExercises: (() => {
        const agg = new Map<
          string,
          {
            exerciseId: string;
            name: string;
            trackingType: string;
            isCustom: boolean;
            sessions: Set<string>;
            setCount: number;
          }
        >();
        for (const r of mostUsedExRes.rows) {
          let entry = agg.get(r.exercise_id);
          if (!entry) {
            entry = {
              exerciseId: r.exercise_id,
              name: r.name,
              trackingType: r.tracking_type,
              isCustom: Boolean(r.is_custom),
              sessions: new Set<string>(),
              setCount: 0,
            };
            agg.set(r.exercise_id, entry);
          }
          entry.sessions.add(r.session_id);
          entry.setCount += Number(r.set_cnt);
        }
        return Array.from(agg.values())
          .map((e) => ({
            exerciseId: e.exerciseId,
            name: e.name,
            trackingType: e.trackingType,
            isCustom: e.isCustom,
            sessionCount: e.sessions.size,
            setCount: e.setCount,
          }))
          .sort(
            (a, b) =>
              b.setCount - a.setCount ||
              b.sessionCount - a.sessionCount ||
              a.name.localeCompare(b.name),
          )
          .slice(0, 10);
      })(),
      customExercises: customExRes.rows.map((r) => ({
        id: r.id,
        name: r.name,
        trackingType: r.tracking_type,
        equipment: r.equipment,
        category: r.category,
        createdAt: r.created_at,
      })),
    },
    featuresUsed: {
      mcp: {
        hasApiKey: Boolean(apiKey),
        keyPrefix: apiKey?.keyPrefix ?? null,
        createdAt: apiKey?.createdAt ?? null,
        lastUsedAt: apiKey?.lastUsedAt ?? null,
      },
      appleHealth: {
        enabled: Boolean(userRow.apple_fitness_enabled),
        lastReceivedAt: userRow.apple_health_last_received_at,
        lastReceivedKind: userRow.apple_health_last_received_kind,
        lastReceivedLinked:
          userRow.apple_health_last_received_linked === null ||
          userRow.apple_health_last_received_linked === undefined
            ? null
            : Boolean(userRow.apple_health_last_received_linked),
        workoutCount: Number(ahCountRow?.cnt ?? 0),
      },
      aiImportCount: eventCountMap.get('ai_import') ?? 0,
      fileImportCount: eventCountMap.get('file_import') ?? 0,
      exportCount: eventCountMap.get('export') ?? 0,
      photoArchiveExportCount: eventCountMap.get('photo_archive_export') ?? 0,
      focusModeUsed:
        userRow.default_workout_view === 'focus' || focusEventCount > 0,
      restClockMode:
        userRow.rest_clock_mode === 'countdown' ? 'countdown' : 'stopwatch',
      photos: {
        count: photoCount,
        totalBytes: photoBytes,
        quota: effectivePhotoQuota,
        quotaUsedPct:
          effectivePhotoQuota > 0
            ? Math.round((photoCount / effectivePhotoQuota) * 1000) / 10
            : photoCount > 0
              ? 100
              : 0,
      },
    },
    timeline,
  };
}
