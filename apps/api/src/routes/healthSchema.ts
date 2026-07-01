import { z } from "zod";

/** Shared health probe response schema — used by both runtime and spec builder. */
export const healthResponseSchema = z.object({ status: z.string() });
