import { z } from "zod";

// ── System Health ────────────────────────────────────────────────

export const SystemHealthResponseSchema = z.object({
  cpu: z.number().min(0).max(100),
  memory: z.number().min(0).max(100),
  dbResponseMs: z.number().min(0),
  status: z.enum(["ok", "degraded", "critical"]),
});
export type SystemHealthResponse = z.infer<typeof SystemHealthResponseSchema>;

// ── Dashboard Stats ─────────────────────────────────────────────

export const DashboardRecentExamSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.string(),
  participantCount: z.number().int().min(0),
});
export type DashboardRecentExam = z.infer<typeof DashboardRecentExamSchema>;

export const DashboardResponseSchema = z.object({
  totalQuestions: z.number().int().min(0),
  activeExams: z.number().int().min(0),
  totalCandidates: z.number().int().min(0),
  todayExams: z.number().int().min(0),
  recentExams: z.array(DashboardRecentExamSchema),
});
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;
