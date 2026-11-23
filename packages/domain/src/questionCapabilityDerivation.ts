import type {
  ContentDocumentV1,
  ContentMode,
} from "./content/contentDocument.js";
import type { QuestionType } from "./enums.js";
import {
  SUPPORTED_PRODUCT_CAPABILITIES,
  type ProductCapabilityId,
} from "./productCapabilities.js";

/**
 * #678 / ADR-022 Phase 2 (:255): the required product capabilities of a
 * question write are DERIVED from the final frozen material — question type,
 * prompt document, option documents and answer mode — never from a preset or
 * profile name. Pure and deterministic: no deployment state, environment,
 * permission or lifecycle fact enters here.
 *
 * Ownership boundaries:
 * - `grading.manual` is deliberately NOT derivable from material. Whether a
 *   deployment may enable `question.text_response` without its manual
 *   completion path is a CONFIGURATION dependency owned by the resolver
 *   (product-capability-composition.md §5), not a property of the material.
 * - Rich prompt / rich option / rich answer are separate slot capabilities;
 *   there is no aggregated "rich" derivation.
 * - The input must be the FINAL merged material of the command (for updates:
 *   stored row merged with the patch, resolved through the content write
 *   authority). Callers judge new commitments only; reads/deletes of legacy
 *   incompatible content are not gated here (ADR-022 D5).
 */

/** Compile-checked mapping from each QuestionType to its catalog capability. */
const QUESTION_TYPE_CAPABILITIES = {
  single_choice: "question.single_choice",
  multiple_choice: "question.multiple_choice",
  fill_blank: "question.fill_blank",
  true_false: "question.true_false",
  text_response: "question.text_response",
} as const satisfies Record<QuestionType, ProductCapabilityId>;

/** The final, persistence-shaped material of one question write command. */
export interface QuestionWriteMaterial {
  readonly type: QuestionType;
  readonly contentDocument: ContentDocumentV1 | null;
  readonly answerMode: ContentMode | null;
  readonly options: ReadonlyArray<{
    readonly contentDocument: ContentDocumentV1 | null;
  }>;
}

/**
 * Derives the deduplicated product capabilities this write introduces, in
 * stable catalog order. A plain slot (null document / null-or-plain answer
 * mode) derives nothing beyond the question type.
 */
export function deriveQuestionRequiredCapabilities(
  material: QuestionWriteMaterial,
): readonly ProductCapabilityId[] {
  const required = new Set<ProductCapabilityId>();
  required.add(QUESTION_TYPE_CAPABILITIES[material.type]);
  if (material.contentDocument != null) {
    required.add("content.prompt.rich");
  }
  if (material.options.some((option) => option.contentDocument != null)) {
    required.add("content.option.rich");
  }
  if (material.answerMode === "rich") {
    required.add("answer.text.rich");
  }
  return SUPPORTED_PRODUCT_CAPABILITIES.filter((capability) =>
    required.has(capability),
  );
}
