const MS_PER_DAY = 86_400_000;

export function formatLocalDate(date: Date = new Date()): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseIsoUtcMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formatIsoUtcMs(ms: number): string {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, deltaDays: number): string {
  return formatIsoUtcMs(parseIsoUtcMs(dateStr) + deltaDays * MS_PER_DAY);
}

export function getWeekStartMonday(dateStr: string): string {
  const ms = parseIsoUtcMs(dateStr);
  const dow = new Date(ms).getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  return formatIsoUtcMs(ms + offset * MS_PER_DAY);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function getDayCellParts(dateStr: string): {
  weekday: string;
  dayNum: number;
} {
  const d = new Date(parseIsoUtcMs(dateStr));
  return {
    weekday: WEEKDAYS[d.getUTCDay()],
    dayNum: d.getUTCDate(),
  };
}

export function formatDayHeader(dateStr: string): string {
  const d = new Date(parseIsoUtcMs(dateStr));
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function formatWeekRange(startStr: string, endStr: string): string {
  const s = new Date(parseIsoUtcMs(startStr));
  const e = new Date(parseIsoUtcMs(endStr));
  const sMonth = MONTHS[s.getUTCMonth()];
  const eMonth = MONTHS[e.getUTCMonth()];
  if (sMonth === eMonth) {
    return `${sMonth} ${s.getUTCDate()} – ${e.getUTCDate()}`;
  }
  return `${sMonth} ${s.getUTCDate()} – ${eMonth} ${e.getUTCDate()}`;
}
