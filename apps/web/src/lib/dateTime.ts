import { formatDuration } from "./utils";

export type DateTimeInput = Date | number | string;

export interface ProductDateTimeFormatter {
  timeZone: string;
  formatDate: (value: DateTimeInput) => string;
  formatTime: (value: DateTimeInput) => string;
  formatDateTime: (value: DateTimeInput) => string;
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

  return {
    timeZone,
    formatDate,
    formatTime,
    formatDateTime: (value) => `${formatDate(value)} ${formatTime(value)}`,
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
