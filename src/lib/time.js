// Sri Lanka uses UTC+05:30 all year (no daylight saving), so "today" for
// SLSEA is the calendar date at that offset.
const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const TIMEZONE = 'Asia/Colombo';

export function colomboToday(now = Date.now()) {
  return new Date(now + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);
}
