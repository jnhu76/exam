export type HealthStatus = "ok" | "degraded" | "critical";

export interface SystemHealthMetrics {
  cpu: number;
  memory: number;
  dbResponseMs: number;
}

export interface SystemHealthResponse {
  cpu: number;
  memory: number;
  dbResponseMs: number;
  status: HealthStatus;
}

export function computeStatus(metrics: SystemHealthMetrics): HealthStatus {
  const { cpu, memory } = metrics;

  if (cpu > 95 || memory > 95) return "critical";
  if (cpu > 80 || memory > 80) return "degraded";
  return "ok";
}
