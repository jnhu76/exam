/** Calculates the absolute deadline from a start time and duration in minutes. */
export function calculateDeadlineAt(
  startedAt: Date,
  durationMinutes: number,
): Date {
  return new Date(startedAt.getTime() + durationMinutes * 60 * 1000);
}

/** Returns the remaining seconds until the deadline, or 0 if the deadline has passed. */
export function getRemainingSeconds(deadlineAt: Date, now: Date): number {
  const diff = deadlineAt.getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / 1000);
}
