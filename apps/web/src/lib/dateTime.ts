import { formatDuration } from "./utils";

export type DateTimeInput = Date | number | string;

export interface ProductDateTimeFormatter {
  timeZone: string;
  formatDate: (value: DateTimeInput) => string;
  formatTime: (value: DateTimeInput) => string;
  formatDateTime: (value: DateTimeInput) => string;
  /** Minute-precision datetime (yyyy-MM-dd HH:mm) for surfaces where the
   * second digits carry no exam-rule meaning and only hurt narrow-viewport
   * readability (e.g. candidate exam windows). The second-precision
   * formatDateTime stays the default for surfaces that document exact
   * ordering (proctor/recovery/audit timelines). */
  formatDateTimeMinute: (value: DateTimeInput) => string;
  formatDateRange: (start: DateTimeInput, end: DateTimeInput) => string;
  formatDuration: typeof formatDuration;
}

const PRODUCT_LOCALE = "zh-CN";

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function resolveProductTimeZone(
  organizationTimeZone?: string | null,
  deploymentTimeZone?: string,
  fallbackTimeZone = browserTimeZone(),
): string {
  return organizationTimeZone || deploymentTimeZone || fallbackTimeZone;
}

function parts(
  value: DateTimeInput,
  timeZone: string,
  fields: Intl.DateTimeFormatOptions,
): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat(PRODUCT_LOCALE, { timeZone, ...fields })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
}

export function createProductDateTimeFormatter(
  timeZone: string,
  _hostLocale?: string,
): ProductDateTimeFormatter {
  const formatDate = (value: DateTimeInput) => {
    const result = parts(value, timeZone, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return `${result.year}-${result.month}-${result.day}`;
  };
  const formatTime = (value: DateTimeInput) => {
    const result = parts(value, timeZone, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    return `${result.hour}:${result.minute}:${result.second}`;
  };
  const formatTimeMinute = (value: DateTimeInput) => {
    const result = parts(value, timeZone, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return `${result.hour}:${result.minute}`;
  };

  return {
    timeZone,
    formatDate,
    formatTime,
    formatDateTime: (value) => `${formatDate(value)} ${formatTime(value)}`,
    formatDateTimeMinute: (value) =>
      `${formatDate(value)} ${formatTimeMinute(value)}`,
    formatDateRange: (start, end) =>
      `${formatDate(start)} — ${formatDate(end)}`,
    formatDuration,
  };
}

export function createFallbackDateTimeFormatter(): ProductDateTimeFormatter {
  return createProductDateTimeFormatter(
    resolveProductTimeZone(
      undefined,
      import.meta.env.VITE_APP_TIMEZONE,
      browserTimeZone(),
    ),
  );
}

// ── Scheduling seam (wall clock ↔ instant) ──
//
// The single authority for the two conversions every scheduling surface
// needs (#971 F-20): an existing ISO instant is rendered back into a
// `datetime-local` wall clock in the SCHEDULING zone, and a user wall clock
// resolves to exactly one instant in that same zone. Both directions name
// the zone explicitly — nothing here reads the browser zone, so results are
// identical under any host time zone.

/** Wall-clock resolution outcomes for a `datetime-local` value. */
export type WallClockResolution =
  | { kind: "unique"; instant: string }
  /** The wall clock occurs twice in this zone (DST fall-back overlap). */
  | { kind: "ambiguous" }
  /** The wall clock does not exist in this zone (DST spring-forward gap). */
  | { kind: "dst-gap" }
  /** Malformed input or an impossible calendar date (e.g. 02-30). */
  | { kind: "invalid" };

const LOCAL_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const DAY_MS = 86_400_000;

/** Zone offset (ms) in effect at `utcMillis`: zone wall clock minus UTC. */
function zoneOffsetMs(utcMillis: number, timeZone: string): number {
  const p = parts(utcMillis, timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return (
    Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    ) - utcMillis
  );
}

function wallInputOf(utcMillis: number, timeZone: string): string {
  const p = parts(utcMillis, timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * Renders an ISO instant as a `datetime-local` wall clock in `timeZone`
 * (minute precision — the input's display granularity). Use the untouched-
 * original-instant rule at the caller for saving, so seconds and DST-overlap
 * instants survive round trips without the input needing second precision.
 * An unparseable value fails closed to the empty input value.
 */
export function instantToLocalInput(
  value: DateTimeInput,
  timeZone: string,
): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  return wallInputOf(instant.getTime(), timeZone);
}

/**
 * Resolves a minute-precision `datetime-local` wall clock (the format the
 * authoring controls emit — no seconds) to a unique instant in `timeZone`.
 * DST gaps and overlaps have no unique resolution — the caller must surface
 * them as field hints and require a uniquely resolvable time; ambiguous and
 * nonexistent wall clocks are never silently snapped to one side. Any other
 * shape (seconds included) is a format error, not a DST outcome.
 */
export function localInputToInstant(
  input: string,
  timeZone: string,
): WallClockResolution {
  const match = LOCAL_INPUT_PATTERN.exec(input);
  if (!match) return { kind: "invalid" };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  // Calendar validity — Date.UTC rolls impossible dates over silently, so
  // check ranges before trusting it. Local date-time strings never carry an
  // offset; hour 24 is not accepted (hourCycle h23 formatting never emits it
  // either).
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59
  ) {
    return { kind: "invalid" };
  }

  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const matchesInput = (utcMillis: number) =>
    wallInputOf(utcMillis, timeZone) === input;

  // The zone offset can differ on either side of a transition bracketing the
  // wall clock, so probe offsets before/at/after the naive UTC reading and
  // keep the candidates whose zone wall clock round-trips to the input.
  const candidates = new Set<number>();
  for (const probe of [guess - DAY_MS, guess, guess + DAY_MS]) {
    const candidate = guess - zoneOffsetMs(probe, timeZone);
    if (matchesInput(candidate)) candidates.add(candidate);
  }

  if (candidates.size === 0) return { kind: "dst-gap" };
  if (candidates.size > 1) return { kind: "ambiguous" };
  const instant = candidates.values().next().value!;
  return { kind: "unique", instant: new Date(instant).toISOString() };
}
