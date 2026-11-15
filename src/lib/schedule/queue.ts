export type ScheduleEventType =
  | 'skip'
  | 'postpone'
  | 'reset'
  | 'jolly_extra'
  | 'jolly_instead';

export type JollyMode = 'extra' | 'instead';

export type CalendarDayStatus =
  | 'unscheduled'
  | 'completed'
  | 'postponed'
  | 'jolly_instead'
  | 'jolly_extra'
  | 'skipped'
  | 'idle'
  | 'rest'
  | 'planned';

export interface QueueDay {
  id: string;
  position: number;
  label: string;
  isRestDay: boolean;
}

export interface QueueEvent {
  id?: string;
  eventDate: string; // YYYY-MM-DD
  eventType: ScheduleEventType;
  shiftDays?: number | null;
  jollyLabel?: string | null;
  createdAt?: string;
}

export interface QueueSession {
  id: string;
  sessionDate: string; // YYYY-MM-DD
  scheduleDayId: string | null;
  isJolly: boolean;
  jollyMode: JollyMode | null;
  title: string;
  completedAt: string | null;
}

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  status: CalendarDayStatus;
  plannedDay: QueueDay | null;
  skippedLabel: string | null;
  sessions: QueueSession[];
  events: QueueEvent[];
  pointerIndex: number | null;
}

export interface QueuePointer {
  index: number;
  dayId: string | null;
}

export interface ProjectCalendarInput {
  queue: readonly QueueDay[];
  anchorDate: string; // YYYY-MM-DD
  anchorIndex: number;
  events: readonly QueueEvent[];
  sessions: readonly QueueSession[];
  today: string; // YYYY-MM-DD (user's local date)
  rangeStart: string; // YYYY-MM-DD
  rangeEnd: string; // YYYY-MM-DD
}

export interface GetPointerForDateInput {
  queue: readonly QueueDay[];
  anchorDate: string; // YYYY-MM-DD
  anchorIndex: number;
  events: readonly QueueEvent[];
  sessions: readonly QueueSession[];
  today: string; // YYYY-MM-DD (user's local date)
  targetDate: string; // YYYY-MM-DD
}

const MS_PER_DAY = 86_400_000;

function parseIsoDateMs(dateStr: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`Invalid YYYY-MM-DD date: "${dateStr}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: "${dateStr}"`);
  }
  return ms;
}

function formatIsoDateMs(ms: number): string {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  const mod = Math.trunc(index) % length;
  return mod < 0 ? mod + length : mod;
}

function sortQueue(queue: readonly QueueDay[]): QueueDay[] {
  return [...queue].sort((a, b) => a.position - b.position);
}

function groupByDate<T>(
  items: readonly T[],
  getDate: (item: T) => string
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getDate(item);
    const list = map.get(key);
    if (list) {
      list.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

function findLastCompletedPlannedSession(
  daySessions: readonly QueueSession[]
): QueueSession | null {
  let latest: QueueSession | null = null;
  for (const s of daySessions) {
    if (!s.isJolly && s.completedAt !== null) {
      if (
        latest === null ||
        (latest.completedAt !== null && s.completedAt >= latest.completedAt)
      ) {
        latest = s;
      }
    }
  }
  return latest;
}

function buildUnscheduledEntry(
  date: string,
  daySessions: QueueSession[],
  dayEvents: QueueEvent[]
): CalendarDay {
  const completedSession = findLastCompletedPlannedSession(daySessions);
  const hasJollyInstead =
    dayEvents.some((e) => e.eventType === 'jolly_instead') ||
    daySessions.some((s) => s.isJolly && s.jollyMode === 'instead');
  const hasJollyExtra =
    dayEvents.some((e) => e.eventType === 'jolly_extra') ||
    daySessions.some((s) => s.isJolly && s.jollyMode === 'extra');
  const hasSkip = dayEvents.some((e) => e.eventType === 'skip');

  let status: CalendarDayStatus = 'unscheduled';
  if (completedSession) {
    status = 'completed';
  } else if (hasJollyInstead) {
    status = 'jolly_instead';
  } else if (hasJollyExtra) {
    status = 'jolly_extra';
  } else if (hasSkip) {
    status = 'skipped';
  }

  return {
    date,
    status,
    plannedDay: null,
    skippedLabel: null,
    sessions: daySessions,
    events: dayEvents,
    pointerIndex: null,
  };
}

interface SimState {
  qIdx: number;
  postponeRemaining: number;
  hasMissedCurrentItem: boolean;
}

function stepDay(
  date: string,
  today: string,
  sortedQueue: readonly QueueDay[],
  indexById: ReadonlyMap<string, number>,
  daySessions: QueueSession[],
  dayEvents: QueueEvent[],
  state: SimState
): CalendarDay {
  const n = sortedQueue.length;

  // Amendment B.1: reset does NOT restart simulation; when the loop reaches
  // the reset date it sets qIdx = 0 and continues.
  if (dayEvents.some((e) => e.eventType === 'reset')) {
    state.qIdx = 0;
    state.postponeRemaining = 0;
    state.hasMissedCurrentItem = false;
  }

  // Track postpone window starting on this date.
  for (const ev of dayEvents) {
    if (ev.eventType === 'postpone') {
      const raw = ev.shiftDays ?? 1;
      const shift = Number.isFinite(raw) && raw >= 1 ? Math.trunc(raw) : 1;
      if (shift > state.postponeRemaining) {
        state.postponeRemaining = shift;
      }
    }
  }

  const pointerIndex = state.qIdx;
  const plannedDay = sortedQueue[state.qIdx];

  const completedSession = findLastCompletedPlannedSession(daySessions);
  const hasJollyInstead =
    dayEvents.some((e) => e.eventType === 'jolly_instead') ||
    daySessions.some((s) => s.isJolly && s.jollyMode === 'instead');
  const hasJollyExtra =
    dayEvents.some((e) => e.eventType === 'jolly_extra') ||
    daySessions.some((s) => s.isJolly && s.jollyMode === 'extra');
  const hasSkip = dayEvents.some((e) => e.eventType === 'skip');

  // If user actually completed a planned session on this day, honor it even if
  // an earlier postpone window covered this day (and clear remaining postpone).
  if (completedSession && !hasJollyInstead) {
    const matchedIdx =
      completedSession.scheduleDayId !== null
        ? indexById.get(completedSession.scheduleDayId)
        : undefined;
    // Amendment B.2: completion advances to (position(schedule_day_id) + 1) % N
    state.qIdx =
      matchedIdx !== undefined ? (matchedIdx + 1) % n : (state.qIdx + 1) % n;
    state.hasMissedCurrentItem = false;
    state.postponeRemaining = 0;
    return {
      date,
      status: 'completed',
      plannedDay: matchedIdx !== undefined ? sortedQueue[matchedIdx] : plannedDay,
      skippedLabel: null,
      sessions: daySessions,
      events: dayEvents,
      pointerIndex,
    };
  }

  if (state.postponeRemaining > 0) {
    state.postponeRemaining -= 1;
    // qIdx unchanged during postponed days (even if plannedDay would be a rest day)
    return {
      date,
      status: 'postponed',
      plannedDay: null,
      skippedLabel: null,
      sessions: daySessions,
      events: dayEvents,
      pointerIndex,
    };
  }

  if (hasJollyInstead) {
    state.qIdx = (state.qIdx + 1) % n;
    state.hasMissedCurrentItem = false;
    return {
      date,
      status: 'jolly_instead',
      plannedDay,
      skippedLabel: plannedDay.label,
      sessions: daySessions,
      events: dayEvents,
      pointerIndex,
    };
  }

  if (hasJollyExtra) {
    // Jolly extra on a rest day advances past the rest day; on a training day,
    // the planned workout defers to the next day (qIdx unchanged).
    if (plannedDay.isRestDay) {
      state.qIdx = (state.qIdx + 1) % n;
      state.hasMissedCurrentItem = false;
    }
    return {
      date,
      status: 'jolly_extra',
      plannedDay,
      skippedLabel: null,
      sessions: daySessions,
      events: dayEvents,
      pointerIndex,
    };
  }

  if (hasSkip) {
    state.qIdx = (state.qIdx + 1) % n;
    state.hasMissedCurrentItem = false;
    return {
      date,
      status: 'skipped',
      plannedDay,
      skippedLabel: plannedDay.label,
      sessions: daySessions,
      events: dayEvents,
      pointerIndex,
    };
  }

  if (plannedDay.isRestDay) {
    state.qIdx = (state.qIdx + 1) % n;
    state.hasMissedCurrentItem = false;
    return {
      date,
      status: 'rest',
      plannedDay,
      skippedLabel: null,
      sessions: daySessions,
      events: dayEvents,
      pointerIndex,
    };
  }

  if (date < today) {
    // Amendment B.3: only the first missed day of a pending queue item is
    // 'skipped'; subsequent consecutive empty past days are 'idle'.
    // qIdx does not advance so the missed workout carries forward.
    if (!state.hasMissedCurrentItem) {
      state.hasMissedCurrentItem = true;
      return {
        date,
        status: 'skipped',
        plannedDay,
        skippedLabel: plannedDay.label,
        sessions: daySessions,
        events: dayEvents,
        pointerIndex,
      };
    }
    return {
      date,
      status: 'idle',
      plannedDay: null,
      skippedLabel: null,
      sessions: daySessions,
      events: dayEvents,
      pointerIndex,
    };
  }

  // date >= today: project planned workout forward
  state.qIdx = (state.qIdx + 1) % n;
  state.hasMissedCurrentItem = false;
  return {
    date,
    status: 'planned',
    plannedDay,
    skippedLabel: null,
    sessions: daySessions,
    events: dayEvents,
    pointerIndex,
  };
}

/**
 * Projects a rotation queue onto calendar dates [rangeStart .. rangeEnd].
 * Pure function with no DB or timezone dependencies; `today` is the caller's
 * local YYYY-MM-DD date.
 */
export function projectCalendar(input: ProjectCalendarInput): CalendarDay[] {
  const {
    queue,
    anchorDate,
    anchorIndex,
    events,
    sessions,
    today,
    rangeStart,
    rangeEnd,
  } = input;

  const rangeStartMs = parseIsoDateMs(rangeStart);
  const rangeEndMs = parseIsoDateMs(rangeEnd);
  const anchorMs = parseIsoDateMs(anchorDate);
  parseIsoDateMs(today);

  if (rangeStartMs > rangeEndMs) {
    return [];
  }

  const sessionsByDate = groupByDate(sessions, (s) => s.sessionDate);
  const eventsByDate = groupByDate(events, (e) => e.eventDate);
  const sortedQueue = sortQueue(queue);

  if (sortedQueue.length === 0) {
    const out: CalendarDay[] = [];
    for (let ms = rangeStartMs; ms <= rangeEndMs; ms += MS_PER_DAY) {
      const date = formatIsoDateMs(ms);
      out.push(
        buildUnscheduledEntry(
          date,
          sessionsByDate.get(date) ?? [],
          eventsByDate.get(date) ?? []
        )
      );
    }
    return out;
  }

  const indexById = new Map<string, number>();
  for (let i = 0; i < sortedQueue.length; i += 1) {
    indexById.set(sortedQueue[i].id, i);
  }

  const out: CalendarDay[] = [];

  // Amendment B.4: days before anchorDate display only logged sessions & events.
  const unscheduledEndMs = Math.min(rangeEndMs, anchorMs - MS_PER_DAY);
  for (let ms = rangeStartMs; ms <= unscheduledEndMs; ms += MS_PER_DAY) {
    const date = formatIsoDateMs(ms);
    out.push(
      buildUnscheduledEntry(
        date,
        sessionsByDate.get(date) ?? [],
        eventsByDate.get(date) ?? []
      )
    );
  }

  if (rangeEndMs < anchorMs) {
    return out;
  }

  const state: SimState = {
    qIdx: normalizeIndex(anchorIndex, sortedQueue.length),
    postponeRemaining: 0,
    hasMissedCurrentItem: false,
  };

  for (let ms = anchorMs; ms <= rangeEndMs; ms += MS_PER_DAY) {
    const date = formatIsoDateMs(ms);
    const entry = stepDay(
      date,
      today,
      sortedQueue,
      indexById,
      sessionsByDate.get(date) ?? [],
      eventsByDate.get(date) ?? [],
      state
    );
    if (ms >= rangeStartMs) {
      out.push(entry);
    }
  }

  return out;
}

/**
 * Returns the queue pointer entering `targetDate` (after applying any `reset`
 * event on `targetDate`, before completing/advancing `targetDate`).
 * Used for re-anchoring `rotation_anchor_date = today` when editing the split.
 */
export function getPointerForDate(input: GetPointerForDateInput): QueuePointer {
  const { queue, anchorDate, anchorIndex, events, sessions, today, targetDate } =
    input;

  const targetMs = parseIsoDateMs(targetDate);
  const anchorMs = parseIsoDateMs(anchorDate);
  parseIsoDateMs(today);

  const sortedQueue = sortQueue(queue);
  if (sortedQueue.length === 0) {
    return { index: 0, dayId: null };
  }

  const initialIdx = normalizeIndex(anchorIndex, sortedQueue.length);
  if (targetMs < anchorMs) {
    return {
      index: initialIdx,
      dayId: sortedQueue[initialIdx].id,
    };
  }

  const sessionsByDate = groupByDate(sessions, (s) => s.sessionDate);
  const eventsByDate = groupByDate(events, (e) => e.eventDate);
  const indexById = new Map<string, number>();
  for (let i = 0; i < sortedQueue.length; i += 1) {
    indexById.set(sortedQueue[i].id, i);
  }

  const state: SimState = {
    qIdx: initialIdx,
    postponeRemaining: 0,
    hasMissedCurrentItem: false,
  };

  for (let ms = anchorMs; ms < targetMs; ms += MS_PER_DAY) {
    const date = formatIsoDateMs(ms);
    stepDay(
      date,
      today,
      sortedQueue,
      indexById,
      sessionsByDate.get(date) ?? [],
      eventsByDate.get(date) ?? [],
      state
    );
  }

  const targetEvents = eventsByDate.get(targetDate) ?? [];
  if (targetEvents.some((e) => e.eventType === 'reset')) {
    state.qIdx = 0;
  }

  return {
    index: state.qIdx,
    dayId: sortedQueue[state.qIdx].id,
  };
}

/**
 * Maps a queue pointer from `oldDays` to the corresponding position index in
 * `newDays` after a split edit.
 * - If the pointed day ID still exists in `newDays`, returns its new index.
 * - If it was deleted, returns the new index of the next surviving day in the
 *   old rotation order.
 * - If no old days survived, returns 0.
 */
export function remapPointerAfterEdit(
  oldDays: readonly QueueDay[],
  newDays: readonly QueueDay[],
  pointer: QueuePointer | number
): number {
  const sortedNew = sortQueue(newDays);
  if (sortedNew.length === 0) {
    return 0;
  }

  const newIndexById = new Map<string, number>();
  for (let i = 0; i < sortedNew.length; i += 1) {
    newIndexById.set(sortedNew[i].id, i);
  }

  const sortedOld = sortQueue(oldDays);

  let oldIdx = 0;
  let targetDayId: string | null = null;
  if (typeof pointer === 'number') {
    oldIdx = sortedOld.length > 0 ? normalizeIndex(pointer, sortedOld.length) : 0;
    targetDayId = sortedOld[oldIdx]?.id ?? null;
  } else {
    oldIdx =
      sortedOld.length > 0 ? normalizeIndex(pointer.index, sortedOld.length) : 0;
    targetDayId = pointer.dayId ?? sortedOld[oldIdx]?.id ?? null;
  }

  if (targetDayId !== null) {
    const direct = newIndexById.get(targetDayId);
    if (direct !== undefined) {
      return direct;
    }
  }

  // Walk forward in old rotation order to find the next surviving day.
  for (let offset = 1; offset <= sortedOld.length; offset += 1) {
    const candidate = sortedOld[(oldIdx + offset) % sortedOld.length];
    const mapped = newIndexById.get(candidate.id);
    if (mapped !== undefined) {
      return mapped;
    }
  }

  return 0;
}
