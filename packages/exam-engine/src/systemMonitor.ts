/** Overall health status of the system: ok, degraded, or critical. */
export type HealthStatus = "ok" | "degraded" | "critical";

/** Raw system health metrics: CPU usage (0-100), memory usage (0-100), and DB response time. */
export interface SystemHealthMetrics {
  cpu: number;
  memory: number;
  dbResponseMs: number;
}

/** System health response combining metrics with a computed status level. */
export interface SystemHealthResponse {
  cpu: number;
  memory: number;
  dbResponseMs: number;
  status: HealthStatus;
}

/**
 * Computes the health status from CPU and memory metrics.
 * Returns "critical" if either exceeds 95%, "degraded" if either exceeds 80%, otherwise "ok".
 */
export function computeStatus(metrics: SystemHealthMetrics): HealthStatus {
  const { cpu, memory } = metrics;

  if (cpu > 95 || memory > 95) return "critical";
  if (cpu > 80 || memory > 80) return "degraded";
  return "ok";
}
