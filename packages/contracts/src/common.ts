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
 */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().min(1),
  }),
});

/** Type for a standard API error response. */
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Schema for a single field-level validation error detail.
 */
export const ValidationErrorDetailSchema = z.object({
  field: z.string(),
  message: z.string(),
  code: z.string(),
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
