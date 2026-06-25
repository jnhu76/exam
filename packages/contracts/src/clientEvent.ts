import { z } from "zod";

/**
 * Client event categories. `log` is the general frontend logger category;
 * `exam_telemetry` and `proctor` are reserved for future Phase 2+ runtime
 * instrumentation and are accepted by the contract now so the schema does
 * not need a breaking change later.
 */
export const ClientEventKindEnum = z.enum(["log", "exam_telemetry", "proctor"]);
/** Type for a client event kind. */
export type ClientEventKind = z.infer<typeof ClientEventKindEnum>;

/** Severity levels for client events, matching common logger conventions. */
export const ClientEventLevelEnum = z.enum(["debug", "info", "warn", "error"]);
/** Type for a client event level. */
export type ClientEventLevel = z.infer<typeof ClientEventLevelEnum>;

/**
 * Maximum serialized JSON **byte** length of a single event's `metadata` blob.
 * Measured in UTF-8 bytes (not UTF-16 code units) so multi-byte payloads
 * (CJK, emoji) cannot inflate to several times the limit by character count.
 * 32 KiB is generous for structured telemetry while bounding per-row storage.
 */
export const CLIENT_EVENT_METADATA_MAX_BYTES = 32 * 1024;

/**
 * Maximum nesting depth tolerated when walking `metadata`. Anything deeper
 * is rejected to keep the persisted JSON flat and queryable.
 */
export const CLIENT_EVENT_METADATA_MAX_DEPTH = 5;

/**
 * Maximum number of events accepted in a single batch POST. Bounded so a
 * single request cannot flood the table; the buffer flushes well below this.
 */
export const CLIENT_EVENT_BATCH_MAX_SIZE = 50;

/**
 * Walks a plain JS value and returns its maximum nesting depth. Objects and
 * arrays increment depth; primitives are depth 0. Used to enforce the
 * metadata depth limit without relying on `JSON.stringify` quotas.
 */
function measureDepth(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  let max = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  let visited = 0;
  while (stack.length > 0) {
    if (visited++ > 5_000) return Number.POSITIVE_INFINITY;
    const { value: cur, depth } = stack.pop()!;
    if (depth > max) max = depth;
    if (cur !== null && typeof cur === "object") {
      for (const child of Object.values(cur as Record<string, unknown>)) {
        stack.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return max;
}

/**
 * Returns the UTF-8 byte length of a string WITHOUT relying on `TextEncoder`
 * or `Buffer`, so it type-checks in every consumer (Node and browser) under a
 * plain ES2022 lib. The technique collapses UTF-16 surrogate pairs first
 * (each astral-plane code point is 4 UTF-8 bytes), then expands the BMP ranges
 * to one '#' per UTF-8 byte they consume (2-byte, 3-byte), leaving ASCII at 1.
 *
 * This is used for the metadata size cap so multi-byte payloads (CJK, emoji)
 * are measured in bytes rather than UTF-16 code units — preventing a payload
 * from inflating to up to 4x the byte limit by char count.
 */
export function utf8ByteLength(str: string): number {
  return str
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "####") // astral pair = 4 bytes
    .replace(/[\u0800-\uFFFF]/g, "###") // 3-byte BMP range
    .replace(/[\u0080-\u07FF]/g, "##").length; // 2-byte range // remaining chars (ASCII + the substituted '#'s) are 1 byte each
}

/**
 * Schema for a single client event reported from the browser. The server
 * derives `organizationId`, `userId`, `receivedAt`, and `userAgent` itself
 * — they are intentionally absent here so a client cannot forge them.
 *
 * `metadata` is bounded by both nesting depth and serialized size to
 * prevent abuse; the web logger also redacts sensitive keys before send.
 */
export const ClientEventSchema = z
  .object({
    kind: ClientEventKindEnum,
    level: ClientEventLevelEnum,
    name: z
      .string()
      .min(1)
      .max(120)
      // Stable, machine-friendly identifiers: letters, digits, and . _ -.
      // The /i flag makes the check case-insensitive, so BOTH lower-case
      // ("system_diagnostics.refreshed") and PascalCase names are accepted;
      // free-form prose / whitespace is still rejected.
      .regex(/^[a-z0-9][a-z0-9._-]{0,119}$/i),
    occurredAt: z.string().datetime(),
    route: z.string().min(1).max(500).optional(),
    attemptId: z.string().min(1).max(200).optional(),
    examId: z.string().min(1).max(200).optional(),
    questionId: z.string().min(1).max(200).optional(),
    clientSessionId: z.string().min(1).max(200).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((event, ctx) => {
    if (event.metadata !== undefined) {
      const depth = measureDepth(event.metadata);
      if (depth > CLIENT_EVENT_METADATA_MAX_DEPTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["metadata"],
          message: `metadata nesting depth exceeds ${CLIENT_EVENT_METADATA_MAX_DEPTH}`,
        });
        return;
      }
      let serialized: string;
      try {
        // Serialize once; the byte length is measured on this string.
        serialized = JSON.stringify(event.metadata);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["metadata"],
          message: "metadata is not JSON-serializable",
        });
        return;
      }
      const byteLength = utf8ByteLength(serialized);
      if (byteLength > CLIENT_EVENT_METADATA_MAX_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["metadata"],
          message: `metadata exceeds ${CLIENT_EVENT_METADATA_MAX_BYTES} bytes (got ${byteLength})`,
        });
      }
    }
  });

/** Type for a single client event payload (as sent by the browser). */
export type ClientEvent = z.infer<typeof ClientEventSchema>;

/**
 * Schema for a batch client-event upload. The array is length-bounded so a
 * single POST cannot persist an unbounded number of rows.
 */
export const ClientEventBatchSchema = z.object({
  events: z.array(ClientEventSchema).max(CLIENT_EVENT_BATCH_MAX_SIZE),
});

/** Type for a client event batch upload request. */
export type ClientEventBatch = z.infer<typeof ClientEventBatchSchema>;

/**
 * Response schema for `POST /api/client-events`: the count of events the
 * server accepted and persisted.
 */
export const ClientEventBatchResponseSchema = z.object({
  accepted: z.number().int().min(0),
});

/** Type for the client-event batch response. */
export type ClientEventBatchResponse = z.infer<
  typeof ClientEventBatchResponseSchema
>;
