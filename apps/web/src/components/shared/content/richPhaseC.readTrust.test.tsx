/**
 * Phase-C Campaign G (#669) — typed persisted-read trust.
 *
 * Frozen read contract (rich-content-semantic-contract.md §7):
 *   - seven typed read states (empty / plain / legacy_plain / rich_valid /
 *     rich_noncanonical / unsupported_version / corrupt);
 *   - CORRUPT_PERSISTED_RICH != EMPTY_DOCUMENT;
 *   - `typeof value === "string"` must never BY ITSELF establish legacy_plain;
 *   - candidate restore, reload, recovery, STALE_VERSION adoption, grading,
 *     result, export must share ONE semantic interpretation authority.
 *
 * The classifier under test is the production `resolveRichAnswerDocument`;
 * the candidate mount path under test is the production `RichTextAnswerInput`
 * (real lazy Tiptap editor). Consumer map evidence is in the discovery ledger.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ContentDocumentV1Schema } from "@exam/contracts";
import type { ContentDocumentV1 } from "@exam/domain";
import { resolveRichAnswerDocument } from "./richAnswer";
import { RichTextAnswerInput } from "@/components/exam/RichTextAnswerInput";
import { ContentDocumentRenderer } from "./ContentDocumentRenderer";

const VALID: ContentDocumentV1 = {
  docVersion: 1,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "答案" }] }],
};

/** Schema-shaped but noncanonical (unsorted marks, split runs) — schema accepts. */
const NONCANONICAL: ContentDocumentV1 = {
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "答", marks: ["italic", "bold"] },
        { type: "text", text: "案", marks: ["italic", "bold"] },
      ],
    },
  ],
};

/** Envelope-shaped but deep-invalid (unknown inline node). */
const CORRUPT_ENVELOPE = {
  docVersion: 1,
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "mysteryInline", text: "x" }] },
  ],
};

const UNSUPPORTED_VERSION = {
  docVersion: 2,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "v2" }] }],
};

describe("Phase-C Campaign G — resolveRichAnswerDocument classification corpus", () => {
  it("records the classifier's decision for every contract read state", () => {
    const corpus: Array<{
      state: string;
      value: unknown;
      mode: string | null;
    }> = [
      { state: "empty(null, rich mode)", value: null, mode: "rich" },
      { state: "empty(undefined, rich mode)", value: undefined, mode: "rich" },
      { state: "plain-mode string", value: "普通答案", mode: "plain" },
      {
        state: "null-mode string (legacy snapshot)",
        value: "旧答案",
        mode: null,
      },
      { state: "unexplained string in rich mode", value: "str", mode: "rich" },
      { state: "rich_valid canonical", value: VALID, mode: "rich" },
      {
        state: "rich_noncanonical (schema-valid)",
        value: NONCANONICAL,
        mode: "rich",
      },
      {
        state: "unsupported_version",
        value: UNSUPPORTED_VERSION,
        mode: "rich",
      },
      {
        state: "corrupt envelope (unknown inline)",
        value: CORRUPT_ENVELOPE,
        mode: "rich",
      },
      { state: "corrupt: number", value: 42, mode: "rich" },
      { state: "corrupt: array", value: [VALID], mode: "rich" },
    ];
    const decisions = corpus.map(({ state, value, mode }) => ({
      state,
      decision:
        resolveRichAnswerDocument(value, mode) === null
          ? "REJECTED"
          : "ACCEPTED",
    }));
    // Observation contract: the production classifier is a binary gate —
    // rich_valid and rich_noncanonical ACCEPT; every other state rejects to
    // null (caller decides the fallback). Frozen distinctions it does NOT
    // express: legacy_plain vs corrupt vs unsupported_version (all collapse).
    expect(decisions).toEqual([
      { state: "empty(null, rich mode)", decision: "REJECTED" },
      { state: "empty(undefined, rich mode)", decision: "REJECTED" },
      { state: "plain-mode string", decision: "REJECTED" },
      { state: "null-mode string (legacy snapshot)", decision: "REJECTED" },
      { state: "unexplained string in rich mode", decision: "REJECTED" },
      { state: "rich_valid canonical", decision: "ACCEPTED" },
      { state: "rich_noncanonical (schema-valid)", decision: "ACCEPTED" },
      { state: "unsupported_version", decision: "REJECTED" },
      { state: "corrupt envelope (unknown inline)", decision: "REJECTED" },
      { state: "corrupt: number", decision: "REJECTED" },
      { state: "corrupt: array", decision: "REJECTED" },
    ]);
  });

  it("rich_noncanonical is returned UNREPAIRED at read time (no silent normalization)", () => {
    const out = resolveRichAnswerDocument(NONCANONICAL, "rich");
    expect(out).not.toBeNull();
    // The classifier returns the schema-parsed value; the noncanonical mark
    // order and split runs must survive untouched.
    expect(out).toEqual(NONCANONICAL);
  });

  it("CORRUPT_PERSISTED_RICH != EMPTY_DOCUMENT at the render authority: corrupt never renders as an empty document", () => {
    // The renderer itself receives only classifier-validated documents.
    // resolveRichAnswerDocument(corrupt) === null — a typed rejection, never
    // an empty ContentDocumentV1 that would render as blank content.
    expect(resolveRichAnswerDocument(CORRUPT_ENVELOPE, "rich")).toBeNull();
    expect(resolveRichAnswerDocument(CORRUPT_ENVELOPE, "rich")).not.toEqual(
      expect.objectContaining({ type: "doc", content: [] }),
    );
    // The static renderer additionally fails closed on unknown BLOCKS
    // (unknown inlines render as nothing by design; blocks get the
    // controlled placeholder from the zh-CN catalog).
    const unknownBlock = {
      docVersion: 1,
      type: "doc",
      content: [
        { type: "script" },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    } as unknown as ContentDocumentV1;
    const { container } = render(
      <ContentDocumentRenderer document={unknownBlock} />,
    );
    expect(container.textContent).toContain("此内容包含当前版本不支持的元素");
    expect(container.textContent).toContain("after");
  });
});

describe("Phase-C Campaign G — candidate mount path (RichTextAnswerInput, real lazy editor)", () => {
  it("counterexample: unexplained string in a rich slot is adopted as legacy content WITHOUT provenance", async () => {
    // §7: without explicit legacy provenance, a plain string where Rich is
    // authoritative is `corrupt` and "must not be adopted as a valid plain
    // answer by candidate restore". The mount path adopts ANY string.
    render(
      <RichTextAnswerInput value={"未解释的旧字符串"} onChange={() => {}} />,
    );
    const surface = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ProseMirror");
      if (!el) throw new Error("editor not mounted");
      return el;
    });
    expect(surface.textContent).toContain("未解释的旧字符串");
  }, 15000);

  it("counterexample: unsupported_version envelope becomes an EMPTY EDITABLE document (corrupt == empty)", async () => {
    // isContentDocumentV1 fails (docVersion 2) and the value is not a string
    // → plainTextToDocument("") → empty editor. A subsequent autosave would
    // silently replace the v2 value — the exact C4 overwrite shape.
    const onChange = vi.fn();
    render(
      <RichTextAnswerInput value={UNSUPPORTED_VERSION} onChange={onChange} />,
    );
    await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ProseMirror");
      if (!el) throw new Error("editor not mounted");
      return el;
    });
    // Give the editor mount transaction a beat, then inspect the emitted
    // canonical value: it is an EMPTY canonical document (normalize leaves
    // zero blocks), not a typed integrity failure. A subsequent autosave
    // would persist exactly this over the v2 value.
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    const emitted = onChange.mock.calls.at(-1)?.[0];
    expect(emitted).toEqual({
      docVersion: 1,
      type: "doc",
      content: [],
    });
  }, 15000);

  it("counterexample: corrupt envelope-shaped value passes the shallow gate into the editor", async () => {
    // isContentDocumentV1(CORRUPT_ENVELOPE) === true (envelope matches), so
    // the deep-invalid document is handed to contentDocumentToTiptap. Observe
    // the production outcome (declared adapter behavior: throw on unknown
    // inline; RichContentEditor catches conversion throws at onUpdate but the
    // MOUNT path surface must be recorded here).
    render(
      <RichTextAnswerInput value={CORRUPT_ENVELOPE} onChange={() => {}} />,
    );
    await vi.waitFor(
      () => {
        const el = document.querySelector<HTMLElement>(".ProseMirror");
        if (!el) throw new Error("editor not mounted");
        return el;
      },
      { timeout: 10000 },
    );
    // NOTE (ledger): the editor mounts; the unknown inline is dropped by the
    // adapter's inline mapping fail-safe — no typed integrity failure is
    // shown to the candidate; the corrupt draft can be overwritten by the
    // next autosave (C4 class, reachability = corruption only).
    expect(document.querySelector(".ProseMirror")).not.toBeNull();
  }, 15000);
});
