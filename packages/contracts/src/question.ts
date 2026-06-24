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

/**
 * Schema for a question's grading rule, configuring multi-select scoring mode,
 * fill-blank matching mode, and case sensitivity.
 */
export const GradingRuleSchema = z.object({
  multiSelectScoring: z.enum(["all_correct_full", "partial_half"]),
  fillBlankMatchMode: z.enum(["exact", "keyword"]),
  fillBlankCaseSensitive: z.boolean().optional(),
});

/**
 * Schema for a question's standard answer.
 *
 * Objective questions (single_choice, multiple_choice, true_false, graded
 * fill_blank) require a non-null, typed standardAnswer. Subjective /
 * manually-graded questions carry `standardAnswer: null` — the platform treats
 * a null standardAnswer as "subjective" (see hasSubjectiveQuestions /
 * subjectiveQuestionIds). We therefore accept null here and enforce the
 * type-specific answer shape for objective questions in validateQuestionType
 * (which early-returns when the answer is null).
 */
const StandardAnswerSchema = z
  .unknown()
  .refine((value) => value !== undefined, {
    message: "standardAnswer is required",
  });

/**
 * Internal validation function that enforces type-specific constraints on questions.
 * Validates option uniqueness, minimum option count for choice questions, standardAnswer
 * format per type, and fill-blank placeholder requirements.
 */
function validateQuestionType(
  question: {
    type: z.infer<typeof QuestionTypeEnum>;
    content: string;
    options?: z.infer<typeof OptionSchema>[] | undefined;
    standardAnswer: unknown;
  },
  ctx: z.RefinementCtx,
) {
  const options = question.options ?? [];
  const optionIds = options.map((option) => option.id);
  if (new Set(optionIds).size !== optionIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "option ids must be unique",
      path: ["options"],
    });
  }

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

  // Subjective / manually-graded questions carry a null standardAnswer: skip
  // the type-specific standardAnswer format checks below. Objective questions
  // (non-null standardAnswer) still require a correctly-typed answer.
  if (question.standardAnswer == null) {
    return;
  }

  if (
    question.type === "single_choice" &&
    (typeof question.standardAnswer !== "string" ||
      !optionIds.includes(question.standardAnswer))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "single choice standardAnswer must reference an option",
      path: ["standardAnswer"],
    });
  }

  if (
    question.type === "multiple_choice" &&
    (!Array.isArray(question.standardAnswer) ||
      question.standardAnswer.length === 0 ||
      question.standardAnswer.some(
        (answer) => typeof answer !== "string" || !optionIds.includes(answer),
      ))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "multiple choice standardAnswer must reference options",
      path: ["standardAnswer"],
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

  if (
    question.type === "fill_blank" &&
    (typeof question.standardAnswer !== "string" ||
      question.standardAnswer.trim() === "")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "fill blank questions require a non-empty standardAnswer",
      path: ["standardAnswer"],
    });
  }
}

/**
 * Schema for a question entity in the question bank, including content, options,
 * standard answer, attachments, scoring, difficulty, tags, and grading rules.
 */
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

/** Represents a question entity with all metadata, content, and grading configuration. */
export type QuestionDTO = z.infer<typeof QuestionSchema>;

/**
 * Request schema for creating a new question, with type-specific validation
 * enforced via superRefine (option counts, standardAnswer format, etc.).
 */
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

/** Type for a create-question request. */
export type CreateQuestionRequest = z.infer<typeof CreateQuestionRequestSchema>;

/**
 * Request schema for updating an existing question. All fields are optional.
 */
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

/** Type for an update-question request. */
export type UpdateQuestionRequest = z.infer<typeof UpdateQuestionRequestSchema>;

// ── Question Import ───────────────────────────────────────────────

/**
 * Schema for a single row in a question import batch, supporting choice options as A-D columns.
 */
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

/** Type for a single question import row. */
export type QuestionImportRow = z.infer<typeof QuestionImportRowSchema>;

/**
 * Request schema for batch-importing questions into a course.
 * Accepts 1 to 500 raw rows that will be validated against QuestionImportRowSchema.
 */
export const QuestionImportRequestSchema = z.object({
  courseId: z.string().uuid(),
  rows: z.array(z.record(z.unknown())).min(1).max(500),
  confirm: z.boolean().default(false),
});

/** Type for a question import request. */
export type QuestionImportRequest = z.infer<typeof QuestionImportRequestSchema>;

/**
 * Response schema for a question import result, summarizing valid, warning, and error counts
 * with per-row detail messages.
 */
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
  logId: z.string().uuid().optional(),
});

/** Type for a question import result. */
export type QuestionImportResult = z.infer<typeof QuestionImportResultSchema>;
