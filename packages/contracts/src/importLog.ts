import { z } from "zod";
import { PaginationParamsSchema, PaginatedResponseSchema } from "./common.js";

export const ImportJobLogTypeEnum = z.enum(["candidate", "question"]);

export const ImportJobLogStatusEnum = z.enum([
  "completed",
  "partial",
  "failed",
]);

const importErrorDetailSchema = z.object({
  row: z.number().int(),
  code: z.string(),
  message: z.string(),
});

export const ImportJobLogSchema = z.object({
  id: z.string().uuid(),
  type: ImportJobLogTypeEnum,
  status: ImportJobLogStatusEnum,
  total: z.number().int(),
  createdCount: z.number().int(),
  updatedCount: z.number().int(),
  errors: z.number().int(),
  metadata: z.record(z.unknown()),
  errorsDetail: z.array(importErrorDetailSchema).nullable(),
  createdAt: z.string().datetime(),
});

export type ImportJobLog = z.infer<typeof ImportJobLogSchema>;

export const ImportLogListQuerySchema = PaginationParamsSchema.extend({
  type: ImportJobLogTypeEnum.optional(),
});

export type ImportLogListQuery = z.infer<typeof ImportLogListQuerySchema>;

export const ImportLogListResponseSchema =
  PaginatedResponseSchema(ImportJobLogSchema);

export type ImportLogListResponse = z.infer<typeof ImportLogListResponseSchema>;
