import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import i18n from "@/i18n";

/** Merges Tailwind CSS class names, deduplicating and resolving conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Structured duration breakdown, locale-independent (used by i18n formatting). */
export interface DurationParts {
  /** <1s durations are rendered in milliseconds (no sec/min/hour breakdown). */
  milliseconds: number;
  seconds: number;
  minutes: number;
  hours: number;
  /** Mirrors the historical bucketing so callers pick the right i18n key. */
  bucket:
    | "ms"
    | "seconds"
    | "minutes"
    | "minuteSecond"
    | "hours"
    | "hourMinute";
}

/**
 * Breaks milliseconds into locale-independent numeric parts plus a bucket
 * discriminator. The bucket tells the caller which `common.duration.*` i18n
 * key to use. No display copy lives here.
 *
 * - <1000ms       → bucket "ms"        (milliseconds only)
 * - 1s–59s        → bucket "seconds"   (seconds only)
 * - 1m, 0s        → bucket "minutes"   (minutes only)
 * - 1m, >0s       → bucket "minuteSecond"
 * - ≥1h, 0m       → bucket "hours"
 * - ≥1h, >0m      → bucket "hourMinute"
 */
export function formatDurationParts(ms: number): DurationParts {
  if (ms < 1000) {
    return {
      milliseconds: Math.round(ms),
      seconds: 0,
      minutes: 0,
      hours: 0,
      bucket: "ms",
    };
  }
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) {
    return {
      milliseconds: 0,
      seconds: totalSec,
      minutes: 0,
      hours: 0,
      bucket: "seconds",
    };
  }
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) {
    return sec > 0
      ? {
          milliseconds: 0,
          seconds: sec,
          minutes: min,
          hours: 0,
          bucket: "minuteSecond",
        }
      : {
          milliseconds: 0,
          seconds: 0,
          minutes: min,
          hours: 0,
          bucket: "minutes",
        };
  }
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0
    ? {
        milliseconds: 0,
        seconds: 0,
        minutes: remMin,
        hours: hr,
        bucket: "hourMinute",
      }
    : { milliseconds: 0, seconds: 0, minutes: 0, hours: hr, bucket: "hours" };
}

/**
 * Formats milliseconds into a human-readable duration string using the default
 * i18n instance (zh-CN). Kept as a convenience for the few non-component
 * call sites that want a ready-to-render string; component call sites should
 * prefer `formatDurationParts(ms)` + their own `t()` scope. Output matches the
 * historical Chinese format exactly (resolves `common.duration.*` keys).
 */
export function formatDuration(ms: number): string {
  const t = i18n.getFixedT?.(i18n.language) ?? i18n.t.bind(i18n);
  const parts = formatDurationParts(ms);
  switch (parts.bucket) {
    case "ms":
      return t("common.duration.millisecond", { value: parts.milliseconds });
    case "seconds":
      return t("common.duration.second", { value: parts.seconds });
    case "minutes":
      return t("common.duration.minute", { value: parts.minutes });
    case "minuteSecond":
      return t("common.duration.minuteSecond", {
        minutes: parts.minutes,
        seconds: parts.seconds,
      });
    case "hours":
      return t("common.duration.hour", { value: parts.hours });
    case "hourMinute":
      return t("common.duration.hourMinute", {
        hours: parts.hours,
        minutes: parts.minutes,
      });
  }
}
