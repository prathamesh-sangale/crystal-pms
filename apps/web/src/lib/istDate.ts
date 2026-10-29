/** One shared notion of "today"/"now", anchored to India Standard Time --
 * not whatever timezone the device/browser happens to be in. The pattern
 * this replaces everywhere (`new Date().toISOString().slice(0, 10)`)
 * converts to UTC first, which silently rolls "today" back a day during
 * IST's early morning (IST is UTC+5:30) -- a real, repeated bug across
 * this app (found in `v2Store.tsx`, `mockV2.ts`, `LiveBoard.tsx`,
 * `Hydra.tsx`, `GateFormDialog.tsx`, `imsQuickAdd.ts`, `YardReport.tsx`),
 * not just the one instance already fixed once. `Intl.DateTimeFormat`
 * with an explicit `timeZone` computes the IST calendar date directly,
 * regardless of the runtime's own timezone -- correct whether this runs
 * in a browser set to IST already, a server running in UTC, or anywhere
 * else, rather than relying on the assumption that "local" already means
 * IST. */

const IST_TIME_ZONE = 'Asia/Kolkata';

const ymdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** A 'YYYY-MM-DD' string -- the IST calendar date `d` falls on. */
export function istDay(d: Date = new Date()): string {
  return ymdFormatter.format(d); // en-CA's own date ordering is already Y-M-D
}

/** Today's IST calendar date, as 'YYYY-MM-DD'. */
export function istToday(): string {
  return istDay(new Date());
}

/** `days` from today, in IST -- the IST equivalent of the old
 * `offsetDate`/`daysAgoISO` helpers this replaces. */
export function istDayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return istDay(d);
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' -- the one date format shown anywhere a
 * plain date (not a date+time) is displayed, by direct request ("date
 * picker should be dd/mm/yyyy everywhere"). */
export function formatDMY(isoDay: string): string {
  const [y, m, d] = isoDay.split('-');
  if (!y || !m || !d) return isoDay;
  return `${d}/${m}/${y}`;
}
