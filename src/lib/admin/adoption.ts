import { query, queryOne } from '@/lib/db/connection';
import {
  ensureDailySnapshotIfDue,
  type SnapshotCatalogUsage,
} from './snapshot';

export interface FeatureAdoptionRow {
  key: string;
  label: string;
  everUsers: number;
  last30dUsers: number;
  adoptionPct: number;
}

export interface ThemeDistributionItem {
  theme: string;
  variant: string;
  userCount: number;
}

export interface SplitShapesSummary {
  activeScheduleCount: number;
  daysPerWeekDistribution: Array<{ cycleLength: number; userCount: number }>;
  restDayPatterns: Array<{ pattern: string; userCount: number }>;
  avgExercisesPerTrainingDay: number;
}

export interface AdminAdoptionReport {
  generatedAt: string;
  snapshotComputedAt: string | null;
  registeredUserCount: number;
  features: FeatureAdoptionRow[];
  themeDistribution: ThemeDistributionItem[];
  restClockDistribution: { stopwatch: number; countdown: number };
  workoutViewDistribution: { list: number; focus: number };
  catalogUsage: SnapshotCatalogUsage;
  splitShapes: SplitShapesSummary;
}

async function countDistinctEventUsers(
  eventTypes: string[],
  cutoff30d: string,
): Promise<{ ever: number; last30d: number }> {
  const placeholders = eventTypes.map((_, i) => `$${i + 2}`).join(', ');
  const row = await queryOne<{ ever_cnt: number; d30_cnt: number }>(
    `SELECT
       COUNT(DISTINCT e.user_id)::int AS ever_cnt,
       COUNT(DISTINCT CASE WHEN e.created_at >= $1 THEN e.user_id END)::int AS d30_cnt
     FROM events e
     JOIN users u ON u.id = e.user_id
     WHERE u.is_guest = 0 AND e.event_type IN (${placeholders})`,
    [cutoff30d, ...eventTypes],
  );
  return {
    ever: Number(row?.ever_cnt ?? 0),
    last30d: Number(row?.d30_cnt ?? 0),
  };
}

export async function getAdminAdoptionReport(): Promise<AdminAdoptionReport> {
  const now = new Date();
  const cutoff30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const snapshot = await ensureDailySnapshotIfDue();

  const regRow = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*)::int AS cnt FROM users WHERE is_guest = 0',
  );
  const registeredUserCount = Number(regRow?.cnt ?? 0);
  const pct = (n: number) =>
    registeredUserCount > 0
      ? Math.round((n / registeredUserCount) * 1000) / 10
      : 0;

  const [
    aiImport,
    fileImport,
    exportEv,
    themeEv,
    focusEv,
    clockEv,
    mcpRow,
    appleHealthRow,
    customExRow,
    photosRow,
    focusUsersRow,
    themeDistRes,
    modeDistRes,
    splitRowsRes,
  ] = await Promise.all([
    countDistinctEventUsers(['ai_import'], cutoff30d),
    countDistinctEventUsers(['file_import'], cutoff30d),
    countDistinctEventUsers(['export', 'photo_archive_export'], cutoff30d),
    countDistinctEventUsers(['theme_changed'], cutoff30d),
    countDistinctEventUsers(['focus_mode_used', 'workout_view_mode_changed'], cutoff30d),
    countDistinctEventUsers(['rest_clock_mode_changed'], cutoff30d),
    queryOne<{ ever_cnt: number; d30_cnt: number }>(
      `SELECT
         COUNT(DISTINCT k.user_id)::int AS ever_cnt,
         COUNT(DISTINCT CASE WHEN k.last_used_at >= $1 THEN k.user_id END)::int AS d30_cnt
       FROM api_keys k
       JOIN users u ON u.id = k.user_id
       WHERE u.is_guest = 0 AND k.last_used_at IS NOT NULL`,
      [cutoff30d],
    ),
    queryOne<{ ever_cnt: number; d30_cnt: number }>(
      `SELECT
         COUNT(*)::int AS ever_cnt,
         COALESCE(SUM(CASE WHEN apple_health_last_received_at >= $1 THEN 1 ELSE 0 END), 0)::int AS d30_cnt
       FROM users
       WHERE is_guest = 0 AND apple_health_last_received_at IS NOT NULL`,
      [cutoff30d],
    ),
    queryOne<{ ever_cnt: number; d30_cnt: number }>(
      `SELECT
         COUNT(DISTINCT e.user_id)::int AS ever_cnt,
         COUNT(DISTINCT CASE WHEN e.created_at >= $1 THEN e.user_id END)::int AS d30_cnt
       FROM exercises e
       JOIN users u ON u.id = e.user_id
       WHERE u.is_guest = 0 AND e.is_custom = 1`,
      [cutoff30d],
    ),
    queryOne<{ ever_cnt: number; d30_cnt: number }>(
      `SELECT
         COUNT(DISTINCT pp.user_id)::int AS ever_cnt,
         COUNT(DISTINCT CASE WHEN pp.created_at >= $1 THEN pp.user_id END)::int AS d30_cnt
       FROM progress_photos pp
       JOIN users u ON u.id = pp.user_id
       WHERE u.is_guest = 0`,
      [cutoff30d],
    ),
    queryOne<{ cnt: number }>(
      `SELECT COUNT(DISTINCT id)::int AS cnt
       FROM users
       WHERE is_guest = 0 AND default_workout_view = 'focus'`,
    ),
    query<{ theme: string; theme_variant: string; cnt: number }>(
      `SELECT theme, theme_variant, COUNT(*)::int AS cnt
       FROM users
       WHERE is_guest = 0
       GROUP BY theme, theme_variant
       ORDER BY cnt DESC, theme ASC`,
    ),
    queryOne<{
      stopwatch_cnt: number;
      countdown_cnt: number;
      list_cnt: number;
      focus_cnt: number;
      non_default_theme_cnt: number;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN rest_clock_mode = 'stopwatch' THEN 1 ELSE 0 END), 0)::int AS stopwatch_cnt,
         COALESCE(SUM(CASE WHEN rest_clock_mode = 'countdown' THEN 1 ELSE 0 END), 0)::int AS countdown_cnt,
         COALESCE(SUM(CASE WHEN default_workout_view = 'list' THEN 1 ELSE 0 END), 0)::int AS list_cnt,
         COALESCE(SUM(CASE WHEN default_workout_view = 'focus' THEN 1 ELSE 0 END), 0)::int AS focus_cnt,
         COALESCE(SUM(CASE WHEN theme <> 'notebook' OR theme_variant <> 'light' THEN 1 ELSE 0 END), 0)::int AS non_default_theme_cnt
       FROM users
       WHERE is_guest = 0`,
    ),
    query<{
      schedule_id: string;
      day_id: string;
      position: number;
      is_rest_day: number;
      exercise_cnt: number;
    }>(
      `SELECT
         s.id AS schedule_id,
         sd.id AS day_id,
         sd.position,
         sd.is_rest_day,
         COUNT(sde.id)::int AS exercise_cnt
       FROM schedules s
       JOIN users u ON u.id = s.user_id AND u.is_guest = 0
       JOIN schedule_days sd ON sd.schedule_id = s.id
       LEFT JOIN schedule_day_exercises sde ON sde.schedule_day_id = sd.id
       WHERE s.is_active = 1
       GROUP BY s.id, sd.id, sd.position, sd.is_rest_day
       ORDER BY s.id, sd.position ASC`,
    ),
  ]);

  const nonDefaultThemeUsers = Number(modeDistRes?.non_default_theme_cnt ?? 0);
  const themesEver = Math.max(themeEv.ever, nonDefaultThemeUsers);
  const focusUsersEver = Math.max(
    focusEv.ever,
    Number(focusUsersRow?.cnt ?? 0),
  );
  const countdownCount = Number(modeDistRes?.countdown_cnt ?? 0);
  const stopwatchCount = Number(modeDistRes?.stopwatch_cnt ?? 0);

  const features: FeatureAdoptionRow[] = [
    {
      key: 'ai_import',
      label: 'AI Plan Import',
      everUsers: aiImport.ever,
      last30dUsers: aiImport.last30d,
      adoptionPct: pct(aiImport.ever),
    },
    {
      key: 'file_import',
      label: 'File Imports (Restore / Health)',
      everUsers: fileImport.ever,
      last30dUsers: fileImport.last30d,
      adoptionPct: pct(fileImport.ever),
    },
    {
      key: 'mcp',
      label: 'MCP / API Key Active',
      everUsers: Number(mcpRow?.ever_cnt ?? 0),
      last30dUsers: Number(mcpRow?.d30_cnt ?? 0),
      adoptionPct: pct(Number(mcpRow?.ever_cnt ?? 0)),
    },
    {
      key: 'apple_health',
      label: 'Apple Health Sync',
      everUsers: Number(appleHealthRow?.ever_cnt ?? 0),
      last30dUsers: Number(appleHealthRow?.d30_cnt ?? 0),
      adoptionPct: pct(Number(appleHealthRow?.ever_cnt ?? 0)),
    },
    {
      key: 'export',
      label: 'Data / Photo Export',
      everUsers: exportEv.ever,
      last30dUsers: exportEv.last30d,
      adoptionPct: pct(exportEv.ever),
    },
    {
      key: 'custom_exercises',
      label: 'Custom Exercises',
      everUsers: Number(customExRow?.ever_cnt ?? 0),
      last30dUsers: Number(customExRow?.d30_cnt ?? 0),
      adoptionPct: pct(Number(customExRow?.ever_cnt ?? 0)),
    },
    {
      key: 'themes',
      label: 'Custom Themes / Dark Mode',
      everUsers: themesEver,
      last30dUsers: themeEv.last30d,
      adoptionPct: pct(themesEver),
    },
    {
      key: 'focus_mode',
      label: 'Focus Mode',
      everUsers: focusUsersEver,
      last30dUsers: focusEv.last30d,
      adoptionPct: pct(focusUsersEver),
    },
    {
      key: 'countdown_clock',
      label: 'Countdown Rest Clock',
      everUsers: countdownCount,
      last30dUsers: clockEv.last30d,
      adoptionPct: pct(countdownCount),
    },
    {
      key: 'photos',
      label: 'Progress Photos',
      everUsers: Number(photosRow?.ever_cnt ?? 0),
      last30dUsers: Number(photosRow?.d30_cnt ?? 0),
      adoptionPct: pct(Number(photosRow?.ever_cnt ?? 0)),
    },
  ];

  // Compute split shapes
  const daysBySched = new Map<
    string,
    Array<{ isRestDay: boolean; exerciseCount: number }>
  >();
  for (const r of splitRowsRes.rows) {
    const arr = daysBySched.get(r.schedule_id) ?? [];
    arr.push({
      isRestDay: Boolean(r.is_rest_day),
      exerciseCount: Number(r.exercise_cnt),
    });
    daysBySched.set(r.schedule_id, arr);
  }

  const cycleLenMap = new Map<number, number>();
  const restPatternMap = new Map<string, number>();
  let totalTrainingDays = 0;
  let totalTrainingExercises = 0;

  for (const days of daysBySched.values()) {
    const cycleLen = days.length;
    cycleLenMap.set(cycleLen, (cycleLenMap.get(cycleLen) ?? 0) + 1);

    const pattern = days.map((d) => (d.isRestDay ? 'R' : 'T')).join('-');
    restPatternMap.set(pattern, (restPatternMap.get(pattern) ?? 0) + 1);

    for (const d of days) {
      if (!d.isRestDay) {
        totalTrainingDays += 1;
        totalTrainingExercises += d.exerciseCount;
      }
    }
  }

  return {
    generatedAt: now.toISOString(),
    snapshotComputedAt: snapshot?.computedAt ?? null,
    registeredUserCount,
    features,
    themeDistribution: themeDistRes.rows.map((r) => ({
      theme: r.theme,
      variant: r.theme_variant,
      userCount: Number(r.cnt),
    })),
    restClockDistribution: {
      stopwatch: stopwatchCount,
      countdown: countdownCount,
    },
    workoutViewDistribution: {
      list: Number(modeDistRes?.list_cnt ?? 0),
      focus: Number(modeDistRes?.focus_cnt ?? 0),
    },
    catalogUsage: snapshot?.catalogUsage ?? {
      mostLogged: [],
      leastLogged: [],
      unusedCatalog: [],
      unusedCatalogCount: 0,
      customExerciseCandidates: [],
    },
    splitShapes: {
      activeScheduleCount: daysBySched.size,
      daysPerWeekDistribution: Array.from(cycleLenMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([cycleLength, userCount]) => ({ cycleLength, userCount })),
      restDayPatterns: Array.from(restPatternMap.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 15)
        .map(([pattern, userCount]) => ({ pattern, userCount })),
      avgExercisesPerTrainingDay:
        totalTrainingDays > 0
          ? Math.round((totalTrainingExercises / totalTrainingDays) * 10) / 10
          : 0,
    },
  };
}
