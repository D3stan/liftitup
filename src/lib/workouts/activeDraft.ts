import { DRAFT_PREFIX, type DraftStorageLike } from '@/lib/offline/outbox';
import {
  computeRestClockState,
  formatClockSeconds,
  type DraftRestClock,
} from '@/lib/workouts/clock';

export type ActiveWorkoutMode = 'planned' | 'extra' | 'instead';

export interface ActiveWorkoutSummary {
  draftKey: string;
  date: string;
  mode: ActiveWorkoutMode;
  href: string;
  title: string;
  startedAt: string | null;
  updatedAt: string | null;
  completedWorkingSets: number;
  totalWorkingSets: number;
  completedWarmupSets: number;
  restClock: DraftRestClock | null;
}

export type ParsedUserDraftKey =
  | {
      kind: 'new';
      baseDraftKey: string;
      date: string;
      mode: ActiveWorkoutMode;
    }
  | {
      kind: 'edit';
      baseDraftKey: string;
      sessionId: string;
    };

function resolveBrowserStorage(
  storage?: DraftStorageLike,
): DraftStorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isValidYmd(ymd: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function parseValidIsoMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

export function parseUserDraftStorageKey(
  storageKey: string,
  userId: string,
): ParsedUserDraftKey | null {
  if (!userId || !userId.trim()) return null;
  const userPrefix = `${DRAFT_PREFIX}user:${encodeURIComponent(userId)}:`;
  if (!storageKey.startsWith(userPrefix)) return null;

  const baseDraftKey = storageKey.slice(userPrefix.length);
  if (!baseDraftKey) return null;

  if (baseDraftKey.startsWith('edit:')) {
    const sessionId = baseDraftKey.slice('edit:'.length);
    return sessionId ? { kind: 'edit', baseDraftKey, sessionId } : null;
  }

  const newMatch = /^new:(\d{4}-\d{2}-\d{2}):(planned|extra|instead)$/.exec(
    baseDraftKey,
  );
  if (!newMatch) return null;
  const [, date, mode] = newMatch;
  if (!isValidYmd(date)) return null;

  return {
    kind: 'new',
    baseDraftKey,
    date,
    mode: mode as ActiveWorkoutMode,
  };
}

export function buildActiveWorkoutHref(
  date: string,
  mode: ActiveWorkoutMode,
): string {
  const base = `/workout/${encodeURIComponent(date)}/log`;
  if (mode === 'planned') return base;
  return `${base}?jolly=${encodeURIComponent(mode)}`;
}

/**
 * Returns true when a new-workout draft represents an actually started /
 * in-progress workout (started clock, >=1 completed set, or active rest timer).
 * Untouched prefilled drafts opened and immediately left are NOT considered active.
 */
export function isDraftInProgress(draft: unknown): boolean {
  if (!draft || typeof draft !== 'object') return false;
  const record = draft as Record<string, unknown>;

  if (parseValidIsoMs(record.startedAt) !== null) {
    return true;
  }

  if (
    record.restClock &&
    typeof record.restClock === 'object' &&
    (record.restClock as Record<string, unknown>).isActive === true
  ) {
    return true;
  }

  if (Array.isArray(record.exercises)) {
    for (const ex of record.exercises) {
      if (!ex || typeof ex !== 'object') continue;
      const sets = (ex as Record<string, unknown>).sets;
      if (!Array.isArray(sets)) continue;
      for (const s of sets) {
        if (s && typeof s === 'object' && (s as Record<string, unknown>).isCompleted === true) {
          return true;
        }
      }
    }
  }

  return false;
}

function sanitizeActiveRestClock(raw: unknown): DraftRestClock | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (c.isActive !== true) return null;
  if (parseValidIsoMs(c.startedAt) === null) return null;
  const targetSeconds =
    typeof c.targetSeconds === 'number' && Number.isFinite(c.targetSeconds)
      ? c.targetSeconds
      : 0;
  return {
    startedAt: (c.startedAt as string).trim(),
    targetSeconds,
    mode: c.mode === 'countdown' ? 'countdown' : 'stopwatch',
    label: typeof c.label === 'string' ? c.label : '',
    exerciseLocalId:
      typeof c.exerciseLocalId === 'string' ? c.exerciseLocalId : null,
    setLocalId: typeof c.setLocalId === 'string' ? c.setLocalId : null,
    stoppedAt: typeof c.stoppedAt === 'string' ? c.stoppedAt : null,
    isActive: true,
    alertFired: Boolean(c.alertFired),
  };
}

function summarizeDraft(
  parsedKey: Extract<ParsedUserDraftKey, { kind: 'new' }>,
  rawDraft: unknown,
): ActiveWorkoutSummary | null {
  if (!isDraftInProgress(rawDraft)) return null;
  const record = rawDraft as Record<string, unknown>;

  let completedWorkingSets = 0;
  let totalWorkingSets = 0;
  let completedWarmupSets = 0;

  if (Array.isArray(record.exercises)) {
    for (const ex of record.exercises) {
      if (!ex || typeof ex !== 'object') continue;
      const sets = (ex as Record<string, unknown>).sets;
      if (!Array.isArray(sets)) continue;
      for (const s of sets) {
        if (!s || typeof s !== 'object') continue;
        const setObj = s as Record<string, unknown>;
        const isWarmup = Boolean(setObj.isWarmup);
        const isCompleted = setObj.isCompleted === true;
        if (isWarmup) {
          if (isCompleted) completedWarmupSets += 1;
        } else {
          totalWorkingSets += 1;
          if (isCompleted) completedWorkingSets += 1;
        }
      }
    }
  }

  const rawTitle = typeof record.title === 'string' ? record.title.trim() : '';
  const fallbackTitle =
    parsedKey.mode === 'planned' ? 'Workout' : 'Jolly Workout';

  const startedAt =
    parseValidIsoMs(record.startedAt) !== null
      ? (record.startedAt as string).trim()
      : null;
  const updatedAt =
    parseValidIsoMs(record.updatedAt) !== null
      ? (record.updatedAt as string).trim()
      : null;

  return {
    draftKey: parsedKey.baseDraftKey,
    date: parsedKey.date,
    mode: parsedKey.mode,
    href: buildActiveWorkoutHref(parsedKey.date, parsedKey.mode),
    title: rawTitle || fallbackTitle,
    startedAt,
    updatedAt,
    completedWorkingSets,
    totalWorkingSets,
    completedWarmupSets,
    restClock: sanitizeActiveRestClock(record.restClock),
  };
}

function activitySortTimestamp(summary: ActiveWorkoutSummary): number {
  return (
    parseValidIsoMs(summary.updatedAt) ??
    parseValidIsoMs(summary.startedAt) ??
    0
  );
}

/**
 * Scans user-scoped workout drafts in storage and returns the most recently
 * active in-progress workout, or `null` if none is active.
 */
export function findActiveUserWorkout(
  userId: string | null | undefined,
  storage?: DraftStorageLike,
): ActiveWorkoutSummary | null {
  if (!userId || !userId.trim()) return null;
  const store = resolveBrowserStorage(storage);
  if (!store) return null;

  const candidates: ActiveWorkoutSummary[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (!key) continue;
    const parsedKey = parseUserDraftStorageKey(key, userId);
    if (!parsedKey || parsedKey.kind !== 'new') continue;

    try {
      const raw = store.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      const summary = summarizeDraft(parsedKey, parsed);
      if (summary) {
        candidates.push(summary);
      }
    } catch {
      // Ignore malformed JSON drafts
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const tsDiff = activitySortTimestamp(b) - activitySortTimestamp(a);
    if (tsDiff !== 0) return tsDiff;
    const dateDiff = b.date.localeCompare(a.date);
    if (dateDiff !== 0) return dateDiff;
    return b.draftKey.localeCompare(a.draftKey);
  });

  return candidates[0];
}

export function isPathnameOnActiveWorkout(
  active: Pick<ActiveWorkoutSummary, 'date' | 'mode'> | null | undefined,
  pathname: string | null | undefined,
  searchParams?: { get(name: string): string | null } | null,
): boolean {
  if (!active || !pathname) return false;
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const match = /^\/workout\/([^/]+)\/log$/.exec(normalized);
  if (!match) return false;

  let routeDate: string;
  try {
    routeDate = decodeURIComponent(match[1]);
  } catch {
    routeDate = match[1];
  }
  if (routeDate !== active.date) return false;

  if (!searchParams) return true;
  if (searchParams.get('sessionId')) return false;

  const jolly = searchParams.get('jolly');
  if (active.mode === 'planned') {
    return jolly !== 'extra' && jolly !== 'instead';
  }
  return jolly === active.mode;
}

export function areActiveWorkoutsEqual(
  a: ActiveWorkoutSummary | null,
  b: ActiveWorkoutSummary | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.draftKey === b.draftKey &&
    a.date === b.date &&
    a.mode === b.mode &&
    a.href === b.href &&
    a.title === b.title &&
    a.startedAt === b.startedAt &&
    a.completedWorkingSets === b.completedWorkingSets &&
    a.totalWorkingSets === b.totalWorkingSets &&
    a.completedWarmupSets === b.completedWarmupSets &&
    (a.restClock?.isActive ?? false) === (b.restClock?.isActive ?? false) &&
    (a.restClock?.startedAt ?? null) === (b.restClock?.startedAt ?? null) &&
    (a.restClock?.targetSeconds ?? null) === (b.restClock?.targetSeconds ?? null) &&
    (a.restClock?.mode ?? null) === (b.restClock?.mode ?? null)
  );
}

function formatShortYmd(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;
  const dt = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return dt.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatActiveWorkoutSubtitle(
  active: ActiveWorkoutSummary,
  todayYmd: string,
  nowMs: number,
): string {
  const parts: string[] = [];

  if (active.date !== todayYmd) {
    parts.push(formatShortYmd(active.date));
  }

  if (active.restClock?.isActive) {
    const restState = computeRestClockState(active.restClock, nowMs);
    if (restState.isActive) {
      if (restState.mode === 'countdown') {
        parts.push(
          restState.targetReached
            ? 'Rest GO!'
            : `Rest ${formatClockSeconds(Math.ceil(restState.remainingSeconds))}`,
        );
      } else {
        parts.push(`Rest ${formatClockSeconds(restState.elapsedSeconds)}`);
      }
    }
  }

  if (active.totalWorkingSets > 0) {
    parts.push(`${active.completedWorkingSets}/${active.totalWorkingSets} sets`);
  } else if (active.completedWarmupSets > 0) {
    parts.push(`${active.completedWarmupSets} warmup sets`);
  } else if (parts.length === 0) {
    parts.push('Workout in progress');
  }

  return parts.join(' · ');
}
