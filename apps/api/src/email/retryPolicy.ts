/**
 * Deterministic exponential-backoff retry policy for the email outbox (M3).
 *
 *   nextRetryAt = now + baseSeconds * 2 ** (attempts - 1)
 *
 * `attempts` is the post-increment count (i.e. the number of failures so far,
 * including the one just observed). Pure and side-effect free so retry time is
 * fully deterministic and assertable in tests. The caller owns the clock.
 *
 * @param now          - The instant the failure was observed.
 * @param attempts     - Post-increment failure count (>= 1).
 * @param baseSeconds  - Backoff base in seconds (>= 1).
 * @returns The absolute instant at which the next retry may be attempted.
 */
export function computeNextRetryAt(
  now: Date,
  attempts: number,
  baseSeconds: number,
): Date {
  const delaySeconds = baseSeconds * 2 ** (attempts - 1);
  return new Date(now.getTime() + delaySeconds * 1000);
}
