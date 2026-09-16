/**
 * Minimal RFC 5545 event builder — one VEVENT, UTC times, proper escaping and
 * line folding. Just enough for calendar invites; no recurrence or alarms.
 */

const CRLF = "\r\n";

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsTimestamp(isoUtc: string): string {
  return isoUtc.replace(/[-:]/g, "").replace(/Z$/, "Z");
}

/** RFC 5545 §3.1: content lines fold at 75 octets with a CRLF + space. */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  parts.push(rest);
  return parts.join(CRLF);
}

export interface IcsEvent {
  /** Stable unique id, e.g. `booking-42@meetflow`. */
  uid: string;
  /** Fixed-width UTC instants, e.g. `2026-12-05T01:00:00Z`. */
  startAt: string;
  endAt: string;
  summary: string;
  description?: string;
  location?: string;
  /** Cancel/reschedule page, if the guest has one. */
  url?: string;
  /** Organization id (CALSCALE stays Gregorian; this names the prodcer). */
  organizerName?: string;
}

export function buildIcs(event: IcsEvent): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MeetFlow//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${icsTimestamp(new Date().toISOString().slice(0, 19) + "Z")}`,
    `DTSTART:${icsTimestamp(event.startAt)}`,
    `DTEND:${icsTimestamp(event.endAt)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join(CRLF) + CRLF;
}
