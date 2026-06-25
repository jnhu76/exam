import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges Tailwind CSS class names, deduplicating and resolving conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats milliseconds into a human-readable Chinese duration string.
 *
 * - <1s → "XXXms"
 * - 1s–59s → "Xs"
 * - 1m–59m → "Xm" or "Xm Ys"
 * - ≥1h → "Xh Ym"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}秒`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec > 0 ? `${min}分${sec}秒` : `${min}分钟`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}小时${remMin}分钟` : `${hr}小时`;
}
