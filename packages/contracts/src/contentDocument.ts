import { z } from "zod";
import {
  CODE_LANGUAGE_PATTERN,
  CONTENT_DOC_VERSION,
  CONTENT_LIMITS,
  checkContentDocumentLimits,
  preflightContentDocumentStructure,
  type ContentBlockMath,
  type ContentBlock,
  type ContentBulletList,
  type ContentCodeBlock,
  type ContentDocumentV1,
  type ContentHardBreak,
  type ContentInlineMath,
  type ContentListItem,
  type ContentOrderedList,
  type ContentParagraph,
  type ContentTable,
  type ContentTableCell,
  type ContentTableRow,
  type ContentTextRun,
} from "@exam/domain";

/**
 * Wire schema for the Exam-owned ContentDocumentV1 rich content grammar
 * (#301). Mirrors the domain kernel's TypeScript grammar exactly — the type
 * identity is asserted in contentDocument.test.ts.
 *
 * The vocabulary is closed: every object is `.strict()`, so unknown nodes,
 * marks, or attributes fail validation instead of being silently dropped.
 * Image/attachment nodes do not exist until an Asset authority does
 * (ContentDocumentV2).
 */

const MarkTypeEnum = z.enum(["bold", "italic", "underline", "inlineCode"]);

/** Mark list: canonical order is enforced by normalization, exclusivity here. */
const MarksSchema = MarkTypeEnum.array().superRefine((marks, ctx) => {
  if (marks.includes("inlineCode") && marks.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "inlineCode mark must not be combined with other marks",
    });
  }
});

const TextRunSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().max(CONTENT_LIMITS.textRun),
    marks: MarksSchema.optional(),
  })
  .strict();
export const ContentTextRunSchema = TextRunSchema;

const HardBreakSchema = z.object({ type: z.literal("hardBreak") }).strict();
export const ContentHardBreakSchema = HardBreakSchema;

const InlineMathSchema = z
  .object({
    type: z.literal("inlineMath"),
    latex: z.string().min(1).max(CONTENT_LIMITS.latex),
  })
  .strict();
export const ContentInlineMathSchema = InlineMathSchema;

const ContentInlineSchema = z.union([
  TextRunSchema,
  HardBreakSchema,
  InlineMathSchema,
]);

const ParagraphSchema: z.ZodType<ContentParagraph, z.ZodTypeDef, unknown> = z
  .object({
    type: z.literal("paragraph"),
    content: z.array(ContentInlineSchema),
  })
  .strict();

/** Mutual recursion list ⇄ listItem, resolved through z.lazy. */
const ListItemSchema: z.ZodType<ContentListItem, z.ZodTypeDef, unknown> =
  z.lazy(() =>
    z
      .object({
        type: z.literal("listItem"),
        content: z.array(
          z.union([ParagraphSchema, BulletListSchema, OrderedListSchema]),
        ),
      })
      .strict(),
  );

const BulletListSchema: z.ZodType<ContentBulletList, z.ZodTypeDef, unknown> =
  z.lazy(() =>
    z
      .object({
        type: z.literal("bulletList"),
        content: z.array(ListItemSchema),
      })
      .strict(),
  );

const OrderedListSchema: z.ZodType<ContentOrderedList, z.ZodTypeDef, unknown> =
  z.lazy(() =>
    z
      .object({
        type: z.literal("orderedList"),
        content: z.array(ListItemSchema),
      })
      .strict(),
  );

const CodeBlockSchema = z
  .object({
    type: z.literal("codeBlock"),
    language: z
      .string()
      .refine((value) => CODE_LANGUAGE_PATTERN.test(value), {
        message: "codeBlock language must match the bounded language grammar",
      })
      .nullable(),
    text: z.string().max(CONTENT_LIMITS.codeBlock),
  })
  .strict();

const BlockMathSchema = z
  .object({
    type: z.literal("blockMath"),
    latex: z.string().min(1).max(CONTENT_LIMITS.latex),
  })
  .strict();

const TableCellSchema = z
  .object({
    type: z.literal("tableCell"),
    content: z.array(ParagraphSchema).min(1),
  })
  .strict();

const TableRowSchema = z
  .object({
    type: z.literal("tableRow"),
    content: z.array(TableCellSchema).min(1),
  })
  .strict();

const TableSchema = z
  .object({
    type: z.literal("table"),
    content: z.array(TableRowSchema).min(1),
  })
  .strict()
  .superRefine((table, ctx) => {
    // V1 tables are simple rectangles (#301 §10) — no colspan/rowspan. A
    // ragged table cannot be projected or rendered predictably, so it fails
    // closed instead of being silently padded.
    const width = table.content[0]?.content.length ?? 0;
    for (const [index, row] of table.content.entries()) {
      if (row.content.length !== width) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `table rows must be rectangular (row ${index} has ${row.content.length} cells, expected ${width})`,
        });
      }
    }
  });

const ContentBlockSchema = z.union([
  ParagraphSchema,
  BulletListSchema,
  OrderedListSchema,
  CodeBlockSchema,
  BlockMathSchema,
  TableSchema,
]);

/**
 * The recursive ContentDocumentV1 grammar + post-parse structural limits.
 * Module-private: only `ContentDocumentV1Schema` (below) pipes the iterative
 * preflight in front of it, and nothing else may parse with this schema.
 * NEVER parse raw unknown input with this schema directly: the grammar is
 * mutually recursive (z.lazy over lists/tables), so a hostile payload nested
 * thousands of levels deep would overflow the parser here before any limit
 * check runs. Use `ContentDocumentV1Schema`.
 */
const RecursiveContentDocumentV1Schema = z
  .object({
    docVersion: z.literal(CONTENT_DOC_VERSION),
    type: z.literal("doc"),
    content: z.array(ContentBlockSchema),
  })
  .strict()
  .superRefine((doc, ctx) => {
    // Structural limits (node count, depth, serialized size, …) have one
    // authority: the domain kernel's CONTENT_LIMITS walker.
    for (const violation of checkContentDocumentLimits(doc)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: violation });
    }
  });

/**
 * Iterative, bounded structural preflight for an UNKNOWN value about to enter
 * the recursive grammar (issue 301 corrective pass round-2). Runs BEFORE any
 * recursive descent so a deep/large/cyclic payload is rejected by the bounded
 * walker instead of overflowing the recursive parser. The check function keeps
 * this schema's output equal to its input (unknown), so piping it in front of
 * the recursive grammar adds no transform — type identity is preserved.
 */
const RawPreflightSchema: z.ZodType<unknown, z.ZodTypeDef, unknown> =
  z.custom<unknown>(
    (value) => preflightContentDocumentStructure(value).length === 0,
    (value) => ({
      message:
        preflightContentDocumentStructure(value)[0] ??
        "document failed structural preflight",
    }),
  );

/**
 * Public ContentDocumentV1 wire schema — the ONLY parse entry for raw unknown
 * input. It is preflight-safe by construction:
 *
 *   raw unknown
 *     ↓ RawPreflightSchema (iterative, bounded — rejects hostile depth/size)
 *     ↓ RecursiveContentDocumentV1Schema (grammar + limits)
 *
 * Any `parse` / `safeParse` call (Fastify route validation, SaveAnswer
 * canonicalization, client-side guards, read-side re-validation) is safe
 * against deep hostile payloads, so no caller can forget to add its own
 * preflight step.
 */
export const ContentDocumentV1Schema = RawPreflightSchema.pipe(
  RecursiveContentDocumentV1Schema,
);

export type ContentDocumentV1DTO = z.infer<typeof ContentDocumentV1Schema>;

/** Type identity between the wire schema and the domain grammar. */
type AssertExact<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
const _blockIdentity: AssertExact<
  z.infer<typeof ContentBlockSchema>,
  ContentBlock
> = true;
const _textRunIdentity: AssertExact<
  z.infer<typeof TextRunSchema>,
  ContentTextRun
> = true;
const _hardBreakIdentity: AssertExact<
  z.infer<typeof HardBreakSchema>,
  ContentHardBreak
> = true;
const _inlineMathIdentity: AssertExact<
  z.infer<typeof InlineMathSchema>,
  ContentInlineMath
> = true;
const _paragraphIdentity: AssertExact<
  z.infer<typeof ParagraphSchema>,
  ContentParagraph
> = true;
const _listItemIdentity: AssertExact<
  ContentListItem,
  z.infer<typeof ListItemSchema>
> = true;
const _bulletListIdentity: AssertExact<
  ContentBulletList,
  z.infer<typeof BulletListSchema>
> = true;
const _orderedListIdentity: AssertExact<
  ContentOrderedList,
  z.infer<typeof OrderedListSchema>
> = true;
const _codeBlockIdentity: AssertExact<
  z.infer<typeof CodeBlockSchema>,
  ContentCodeBlock
> = true;
const _blockMathIdentity: AssertExact<
  z.infer<typeof BlockMathSchema>,
  ContentBlockMath
> = true;
const _tableIdentity: AssertExact<
  z.infer<typeof TableSchema>,
  ContentTable
> = true;
const _tableRowIdentity: AssertExact<
  z.infer<typeof TableRowSchema>,
  ContentTableRow
> = true;
const _tableCellIdentity: AssertExact<
  z.infer<typeof TableCellSchema>,
  ContentTableCell
> = true;
const _documentIdentity: AssertExact<
  z.infer<typeof ContentDocumentV1Schema>,
  ContentDocumentV1
> = true;
void [
  _blockIdentity,
  _textRunIdentity,
  _hardBreakIdentity,
  _inlineMathIdentity,
  _paragraphIdentity,
  _listItemIdentity,
  _bulletListIdentity,
  _orderedListIdentity,
  _codeBlockIdentity,
  _blockMathIdentity,
  _tableIdentity,
  _tableRowIdentity,
  _tableCellIdentity,
  _documentIdentity,
];

/**
 * Optional rich-content slot shared by question prompt and options: absent /
 * null → Plain (content authoritative); present → Rich (document
 * authoritative, content is the server-derived projection).
 */
export const ContentSlotSchema = ContentDocumentV1Schema.nullish();
export type ContentSlot = z.infer<typeof ContentSlotSchema>;

/** Enum of the author-defined answer input mode for text_response questions. */
export const AnswerModeEnum = z.enum(["plain", "rich"]);
export type AnswerMode = z.infer<typeof AnswerModeEnum>;
