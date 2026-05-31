import { z } from "zod";

// ── Question ──────────────────────────────────────────────────────

const QuestionTypeEnum = z.enum([
  "single_choice",
  "multiple_choice",
  "fill_blank",
  "true_false",
]);

const OptionSchema = z.object({
  id: z.string(),
  content: z.string(),
  isCorrect: z.boolean().optional(),
});

const AttachmentSchema = z.object({
  url: z.string(),
  type: z.enum(["image", "file"]),
  name: z.string(),
});

export const GradingRuleSchema = z.object({
  multiSelectScoring: z.enum(["all_correct_full", "partial_half"]),
  fillBlankMatchMode: z.enum(["exact", "keyword"]),
});

const StandardAnswerSchema = z
  .unknown()
  .refine((value) => value !== undefined && value !== null, {
    message: "standardAnswer is required",
  });

function validateQuestionType(
  question: {
    type: z.infer<typeof QuestionTypeEnum>;
    content: string;
    options?: z.infer<typeof OptionSchema>[] | undefined;
    standardAnswer: unknown;
  },
  ctx: z.RefinementCtx,
) {
  if (
    (question.type === "single_choice" ||
      question.type === "multiple_choice") &&
    (!question.options || question.options.length < 2)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "choice questions require at least two options",
      path: ["options"],
    });
  }

  if (question.type === "fill_blank" && !question.content.includes("____")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "fill blank questions require a ____ placeholder",
      path: ["content"],
    });
  }

  if (
    question.type === "true_false" &&
    typeof question.standardAnswer !== "boolean"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "true/false questions require a boolean standardAnswer",
      path: ["standardAnswer"],
    });
  }
}

export const QuestionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  courseId: z.string().uuid(),
  type: QuestionTypeEnum,
  content: z.string(),
  options: z.array(OptionSchema),
  standardAnswer: StandardAnswerSchema,
  attachments: z.array(AttachmentSchema),
  score: z.number().positive(),
  difficulty: z.number().int().min(1).max(5),
  tags: z.array(z.string()),
  gradingRule: GradingRuleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type QuestionDTO = z.infer<typeof QuestionSchema>;

export const CreateQuestionRequestSchema = z
  .object({
    courseId: z.string().uuid(),
    type: QuestionTypeEnum,
    content: z.string().min(1),
    options: z.array(OptionSchema).optional(),
    standardAnswer: StandardAnswerSchema,
    attachments: z.array(AttachmentSchema).default([]),
    score: z.number().positive(),
    difficulty: z.number().int().min(1).max(5).default(3),
    tags: z.array(z.string()).default([]),
    gradingRule: GradingRuleSchema.default({
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    }),
  })
  .superRefine(validateQuestionType);
export type CreateQuestionRequest = z.infer<typeof CreateQuestionRequestSchema>;

export const UpdateQuestionRequestSchema = z.object({
  courseId: z.string().uuid().optional(),
  type: QuestionTypeEnum.optional(),
  content: z.string().min(1).optional(),
  options: z.array(OptionSchema).optional(),
  standardAnswer: StandardAnswerSchema.optional(),
  attachments: z.array(AttachmentSchema).optional(),
  score: z.number().positive().optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string()).optional(),
  gradingRule: GradingRuleSchema.optional(),
});
export type UpdateQuestionRequest = z.infer<typeof UpdateQuestionRequestSchema>;

// ── Question Import ───────────────────────────────────────────────

export const QuestionImportRowSchema = z.object({
  type: QuestionTypeEnum,
  content: z.string().min(1),
  optionA: z.string().optional(),
  optionB: z.string().optional(),
  optionC: z.string().optional(),
  optionD: z.string().optional(),
  standardAnswer: StandardAnswerSchema,
  score: z.number().positive(),
  difficulty: z.number().int().min(1).max(5).optional(),
  tags: z.string().optional(),
  gradingRule: GradingRuleSchema.default({
    multiSelectScoring: "all_correct_full",
    fillBlankMatchMode: "exact",
  }),
});
export type QuestionImportRow = z.infer<typeof QuestionImportRowSchema>;

export const QuestionImportRequestSchema = z.object({
  courseId: z.string().uuid(),
  rows: z.array(QuestionImportRowSchema).min(1),
});
export type QuestionImportRequest = z.infer<typeof QuestionImportRequestSchema>;

export const QuestionImportResultSchema = z.object({
  total: z.number().int(),
  valid: z.number().int(),
  warnings: z.number().int(),
  errors: z.number().int(),
  details: z.array(
    z.object({
      row: z.number().int(),
      status: z.enum(["valid", "warning", "error"]),
      message: z.string().optional(),
    }),
  ),
});
export type QuestionImportResult = z.infer<typeof QuestionImportResultSchema>;
