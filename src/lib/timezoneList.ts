import { tzOffsetMinutes } from "./timezone";

/** "+08:00", "-05:30", "+00:00" */
export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const mins = String(abs % 60).padStart(2, "0");
  return `${sign}${hours}:${mins}`;
}

/**
 * "Asia/Kuala_Lumpur" -> "Kuala Lumpur", "America/Argentina/Salta" -> "Salta".
 * The IANA list workerd ships contains no duplicate final segments, so the city
 * alone is unambiguous.
 */
export function zoneCity(iana: string): string {
  const last = iana.split("/").pop() ?? iana;
  return last.replace(/_/g, " ");
}

/** "GMT+8", "GMT+5:30", "GMT" — the friendlier form, for prose. */
export function shortOffset(minutes: number): string {
  if (minutes === 0) return "GMT";
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return `GMT${sign}${hours}${mins ? `:${String(mins).padStart(2, "0")}` : ""}`;
}

/**
 * "Kuala Lumpur (GMT+8)" — how a timezone is named anywhere in prose or a
 * detail row. Raw IANA identifiers like `Asia/Kuala_Lumpur` are an
 * implementation detail and are never shown to a person.
 *
 * The picker uses the offset-first `zoneLabel` instead, because that list is
 * sorted by offset and leading with it makes the ordering legible.
 */
export function zoneDisplay(iana: string, at: Date = new Date()): string {
  try {
    return `${zoneCity(iana)} (${shortOffset(tzOffsetMinutes(at, iana))})`;
  } catch {
    return zoneCity(iana);
  }
}

/**
 * "+08:00 Kuala Lumpur". Falls back to the bare city if the identifier is not a
 * zone this runtime knows, so a stale value in the database still renders.
 */
export function zoneLabel(iana: string, at: Date = new Date()): string {
  try {
    return `${formatUtcOffset(tzOffsetMinutes(at, iana))} ${zoneCity(iana)}`;
  } catch {
    return zoneCity(iana);
  }
}
