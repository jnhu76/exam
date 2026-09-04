import { z } from "zod";

// ── Pagination ────────────────────────────────────────────────────

/**
 * Schema for common pagination query parameters (page number and page size).
 */
export const PaginationParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Type for pagination query parameters. */
export type PaginationParams = z.infer<typeof PaginationParamsSchema>;

/**
 * Factory function that creates a paginated response schema for a given item schema.
 * Returns an object with items, total, page, pageSize, and totalPages.
 */
export const PaginatedResponseSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    totalPages: z.number().int(),
  });

/** Generic type for a paginated response containing items and pagination metadata. */
export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

// ── Sort ──────────────────────────────────────────────────────────

/**
 * Schema for sort query parameters (sort field and order).
 */
export const SortParamsSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/** Type for sort query parameters. */
export type SortParams = z.infer<typeof SortParamsSchema>;

// ── Error Response ────────────────────────────────────────────────

/**
 * Standard error response schema returned by API endpoints on failure.
 * Includes a machine-readable code, human message, optional details, and request ID.
 *
 * Semantics are frozen by the Message & Error Contract
 * (docs/contracts/api-contract.md, #413 C0):
 * - `code` is a stable coarse product-level machine contract.
 * - `message` is non-authoritative compatibility text; clients MUST NOT
 *   parse or branch on it. Wording/fallback language is not machine semantics.
 * - `details` may carry `reason` (open-vocabulary stable machine contract),
 *   `params` (structured dynamic context), and `fields[]` (field violations).
 */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z
      .string()
      .describe(
        "Stable coarse product-level machine contract (ErrorCode). Clients branch on this, never on message.",
      ),
    message: z
      .string()
      .describe(
        "Non-authoritative human-readable compatibility text. Clients MUST NOT parse or branch on this value. Wording and fallback language are not stable machine semantics; use code (and details.reason where present) for programmatic handling.",
      ),
    details: z
      .unknown()
      .optional()
      .describe(
        "Structured context, shape varies by code: reason (open-vocabulary machine contract), fields[] (field violations), params (structured dynamic context — top-level since C1, field-level since C2). Extensibility is inventory-gated; unknown shapes must be tolerated.",
      ),
    requestId: z.string().min(1).describe("Request id for support correlation"),
  }),
});

/** Type for a standard API error response. */
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Schema for a single field-level validation error detail.
 *
 * Semantics frozen by the Message & Error Contract (#413 C0): `field` is
 * the machine-addressable path, `code` is the machine semantic, `message`
 * is compatibility human text (non-authoritative). C2 adds `params` for
 * structured dynamic values (additive; value domain frozen to
 * `string | number`).
 */
export const ValidationErrorDetailSchema = z.object({
  field: z
    .string()
    .describe(
      "Machine-addressable field/path. Current array indexes are encoded as dot-separated numeric segments (for example items.0.name). See the Message & Error Contract (docs/contracts/api-contract.md D0.7) for the target path convention.",
    ),
  message: z
    .string()
    .describe(
      "Compatibility human text, non-authoritative. Clients MUST NOT parse or branch on this value.",
    ),
  code: z
    .string()
    .describe("Machine-readable validation or domain reason code."),
  params: z
    .record(z.union([z.string(), z.number()]))
    .optional()
    .describe(
      "Structured dynamic values for this field error (machine contract, message contract D0.4/D0.7). Value domain is frozen to string | number; keys are additive and never redefined once published.",
    ),
});

/** Type for a single field-level validation error. */
export type ValidationErrorDetail = z.infer<typeof ValidationErrorDetailSchema>;

/**
 * Schema for a validation error response containing an array of field-level errors.
 */
export const ValidationErrorDetailsSchema = z.object({
  fields: z.array(ValidationErrorDetailSchema),
});

/** Type for a validation error response with multiple field errors. */
export type ValidationErrorDetails = z.infer<
  typeof ValidationErrorDetailsSchema
>;
