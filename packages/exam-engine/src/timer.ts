export function calculateDeadlineAt(
  startedAt: Date,
  durationMinutes: number,
): Date {
  return new Date(startedAt.getTime() + durationMinutes * 60 * 1000);
}

export function getRemainingSeconds(deadlineAt: Date, now: Date): number {
  const diff = deadlineAt.getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / 1000);
}
