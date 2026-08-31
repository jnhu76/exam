import { ContentDocumentV1Schema } from "@exam/contracts";
import { normalizeContentDocument, type QuestionSnapshot } from "@exam/domain";

/**
 * Per-question answer payload validation (#301 §21).
 *
 * `SaveAnswerRequest.answer` stays `unknown` on the wire (transport layer),
 * but a save must not persist a payload that cannot be the answer to the
 * frozen question it targets. The authority for the expected shape is the
 * FROZEN QuestionSnapshot the attempt carries — never the live question row.
 *
 * For rich text_response answers this is also the CANONICALIZATION seam: the
 * returned value is the normalized ContentDocumentV1, so every downstream
 * consumer (answersEqual idempotency, draft persistence, submit freeze,
 * grading workset) only ever sees canonical documents (#301 §22).
 *
 * `null` remains valid for every type — it is the protocol's "cleared"
 * answer (buildSubmittedAnswersSnapshot normalizes it for unanswered
 * questions).
 */
export type AnswerValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

/** Fill-blank answer keys are `blank-N`, 1-based, over the `____` universe. */
function blankUniverse(content: string): Set<string> {
  const count = content.split("____").length - 1;
  const keys = new Set<string>();
  for (let i = 1; i <= count; i++) keys.add(`blank-${i}`);
  return keys;
}

export function validateAnswerForQuestion(
  question: QuestionSnapshot,
  answer: unknown,
): AnswerValidationResult {
  if (answer === null) return { ok: true, value: null };

  const optionIds = new Set(question.options.map((option) => option.id));

  switch (question.type) {
    case "single_choice": {
      if (typeof answer !== "string" || !optionIds.has(answer)) {
        return {
          ok: false,
          reason: "single_choice answer must be an option id",
        };
      }
      return { ok: true, value: answer };
    }

    case "multiple_choice": {
      if (
        !Array.isArray(answer) ||
        answer.some((id) => typeof id !== "string")
      ) {
        return {
          ok: false,
          reason: "multiple_choice answer must be an array of option ids",
        };
      }
      // Empty selection stays legal (existing deselect-all behavior).
      if (answer.some((id) => !optionIds.has(id))) {
        return {
          ok: false,
          reason: "multiple_choice answer references an unknown option",
        };
      }
      return { ok: true, value: answer };
    }

    case "true_false": {
      if (typeof answer !== "boolean") {
        return { ok: false, reason: "true_false answer must be a boolean" };
      }
      return { ok: true, value: answer };
    }

    case "fill_blank": {
      // fill_blank is Plain-only (#301 §16): the string / Record<string,string>
      // shapes are frozen; keys must stay inside the `____` universe.
      if (typeof answer === "string") {
        return { ok: true, value: answer };
      }
      if (typeof answer !== "object" || Array.isArray(answer)) {
        return {
          ok: false,
          reason:
            "fill_blank answer must be a string or a Record<string,string>",
        };
      }
      const allowed = blankUniverse(question.content);
      for (const [key, value] of Object.entries(answer)) {
        if (typeof value !== "string") {
          return {
            ok: false,
            reason: "fill_blank answer values must be strings",
          };
        }
        if (!allowed.has(key)) {
          return {
            ok: false,
            reason: `fill_blank answer key ${key} is outside the question's blank universe`,
          };
        }
      }
      return { ok: true, value: answer };
    }

    case "text_response": {
      // Legacy snapshots omit answerMode → plain (QuestionSnapshotSchema
      // already normalizes it, so null here means plain).
      if (question.answerMode !== "rich") {
        if (typeof answer !== "string") {
          return {
            ok: false,
            reason: "plain text_response answer must be a string",
          };
        }
        return { ok: true, value: answer };
      }
      const parsed = ContentDocumentV1Schema.safeParse(answer);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "rich text_response answer must be a valid ContentDocumentV1",
        };
      }
      // Canonicalize BEFORE equality/idempotency/persistence (#301 §22).
      return { ok: true, value: normalizeContentDocument(parsed.data) };
    }
  }
}
