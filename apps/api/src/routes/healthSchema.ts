import { z } from "zod";

/** Shared health probe response schema — used by both runtime and spec builder. */
export const healthResponseSchema = z.object({ status: z.string() });

/**
 * #547 readiness probe response. The body carries NOTHING but the gate
 * answer — no dependency names, no latency, no error detail (public route;
 * see docs/research/exam-547-readiness-alerting-1/01-semantics §5).
 */
export const readyResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
});
