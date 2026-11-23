import { describe, expect, it } from "vitest";
import {
  plainTextToDocument,
  type ContentDocumentV1,
} from "./content/contentDocument.js";
import { deriveQuestionRequiredCapabilities } from "./questionCapabilityDerivation.js";

/**
 * ADR-022 :255 — "manual demand and Rich use derived from actual frozen
 * materials, not profile name". This pins the pure derivation contract for
 * Phase 2 write guards: the FINAL question material (question type, prompt
 * document, option documents, answer mode) maps to the
 * `ProductCapabilityId`s the write introduces. No deployment state, preset
 * name or policy enters this function.
 *
 * Ownership boundaries pinned here:
 * - `grading.manual` is NOT derivable from material; the resolver owns the
 *   `question.text_response` → `grading.manual` dependency validation
 *   (product-capability-composition.md §5).
 * - Rich prompt / rich option / rich answer are separate slot capabilities
 *   (§5: 不得用一个模糊 rich=true 推导全部行为).
 */

const RICH_DOC: ContentDocumentV1 = plainTextToDocument("Solve: x^2-1=0");

function sorted(capabilities: readonly string[]): string[] {
  return [...capabilities].sort();
}

describe("question write material → required capabilities (ADR-022 Phase 2)", () => {
  it("maps every question type to exactly its catalog capability", () => {
    const types = [
      "single_choice",
      "multiple_choice",
      "fill_blank",
      "true_false",
      "text_response",
    ] as const;
    for (const type of types) {
      const capabilities = deriveQuestionRequiredCapabilities({
        type,
        contentDocument: null,
        answerMode: null,
        options: [],
      });
      expect(capabilities).toContain(`question.${type}`);
      expect(capabilities, `for ${type}`).toHaveLength(1);
    }
  });

  it("derives no rich capability for plain material", () => {
    const capabilities = deriveQuestionRequiredCapabilities({
      type: "single_choice",
      contentDocument: null,
      answerMode: null,
      options: [{ contentDocument: null }, { contentDocument: null }],
    });
    expect(sorted(capabilities)).toEqual(sorted(["question.single_choice"]));
  });

  it("derives the rich prompt slot capability from the prompt document", () => {
    const capabilities = deriveQuestionRequiredCapabilities({
      type: "text_response",
      contentDocument: RICH_DOC,
      answerMode: null,
      options: [],
    });
    expect(capabilities).toContain("content.prompt.rich");
  });

  it("derives the rich option slot capability from a rich option document", () => {
    const capabilities = deriveQuestionRequiredCapabilities({
      type: "single_choice",
      contentDocument: null,
      answerMode: null,
      options: [{ contentDocument: null }, { contentDocument: RICH_DOC }],
    });
    expect(sorted(capabilities)).toEqual(
      sorted(["question.single_choice", "content.option.rich"]),
    );
  });

  it("derives the rich answer slot capability from a rich answerMode", () => {
    const capabilities = deriveQuestionRequiredCapabilities({
      type: "text_response",
      contentDocument: null,
      answerMode: "rich",
      options: [],
    });
    expect(sorted(capabilities)).toEqual(
      sorted(["question.text_response", "answer.text.rich"]),
    );
  });

  it("keeps plain and null answerMode free of the rich answer capability", () => {
    for (const answerMode of [null, "plain"] as const) {
      const capabilities = deriveQuestionRequiredCapabilities({
        type: "text_response",
        contentDocument: null,
        answerMode,
        options: [],
      });
      expect(capabilities, `for answerMode ${answerMode}`).toEqual([
        "question.text_response",
      ]);
    }
  });

  it("does not derive grading.manual from material (resolver owns the dependency)", () => {
    const capabilities = deriveQuestionRequiredCapabilities({
      type: "text_response",
      contentDocument: RICH_DOC,
      answerMode: "rich",
      options: [],
    });
    expect(capabilities).not.toContain("grading.manual");
  });

  it("derives the deduplicated union of all introduced capabilities", () => {
    // Rich prompt + rich answer on a text_response.
    expect(
      sorted(
        deriveQuestionRequiredCapabilities({
          type: "text_response",
          contentDocument: RICH_DOC,
          answerMode: "rich",
          options: [],
        }),
      ),
    ).toEqual(
      sorted([
        "question.text_response",
        "content.prompt.rich",
        "answer.text.rich",
      ]),
    );

    // Rich prompt + several rich options on a multiple_choice; several rich
    // options still contribute the option capability exactly once.
    expect(
      sorted(
        deriveQuestionRequiredCapabilities({
          type: "multiple_choice",
          contentDocument: RICH_DOC,
          answerMode: null,
          options: [
            { contentDocument: RICH_DOC },
            { contentDocument: RICH_DOC },
            { contentDocument: null },
          ],
        }),
      ),
    ).toEqual(
      sorted([
        "question.multiple_choice",
        "content.prompt.rich",
        "content.option.rich",
      ]),
    );
  });

  it("is deterministic for identical material", () => {
    const material = {
      type: "fill_blank" as const,
      contentDocument: null,
      answerMode: null,
      options: [],
    };
    expect(deriveQuestionRequiredCapabilities(material)).toEqual(
      deriveQuestionRequiredCapabilities(material),
    );
  });
});
