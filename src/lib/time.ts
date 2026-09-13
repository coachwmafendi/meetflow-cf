const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Fixed-width UTC string: YYYY-MM-DDTHH:MM:SSZ (no millis, so TEXT sort == time sort). */
export function isoUtc(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

export function nowIso(): string {
  return isoUtc(new Date());
}

export function parseIsoUtc(value: string): Date {
  if (!ISO_UTC.test(value)) {
    throw new Error(`Invalid UTC timestamp: ${value}`);
  }
  return new Date(value);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}
