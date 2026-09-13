export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone.includes("/") && timeZone !== "UTC") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of `instant` as seen in `timeZone`. */
export function utcToZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Missing ${type} for ${timeZone}`);
    return Number(part.value);
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24, // ICU can emit "24" for midnight under hour12:false
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC, in minutes, at `instant` (DST-aware). */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const p = utcToZonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const instantSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return (asIfUtc - instantSeconds) / 60_000;
}

/**
 * Convert a local wall time in `timeZone` to the corresponding UTC instant.
 * Two-pass: guess with the offset at the naive instant, then correct using the
 * offset at the candidate instant. This resolves DST transitions.
 */
export function zonedToUtc(dateYmd: string, timeHm: string, timeZone: string): Date {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
  const tm = /^(\d{2}):(\d{2})$/.exec(timeHm);
  if (!dm || !tm) throw new Error(`Invalid local datetime: ${dateYmd} ${timeHm}`);

  const naive = Date.UTC(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
    0,
  );

  const firstOffset = tzOffsetMinutes(new Date(naive), timeZone);
  let candidate = naive - firstOffset * 60_000;
  const secondOffset = tzOffsetMinutes(new Date(candidate), timeZone);
  if (secondOffset !== firstOffset) {
    candidate = naive - secondOffset * 60_000;
  }
  return new Date(candidate);
}

/** Day of week (0=Sunday) of `dateYmd` — calendar arithmetic, timezone independent. */
export function dayOfWeek(dateYmd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
  if (!m) throw new Error(`Invalid date: ${dateYmd}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/** The YYYY-MM-DD calendar date `instant` falls on inside `timeZone`. */
export function zonedDateString(instant: Date, timeZone: string): string {
  const p = utcToZonedParts(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** HH:MM of `instant` inside `timeZone`. */
export function zonedTimeString(instant: Date, timeZone: string): string {
  const p = utcToZonedParts(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
