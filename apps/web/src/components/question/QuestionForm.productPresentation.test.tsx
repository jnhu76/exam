import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  MINIMAL_PRODUCT_CONFIGURATION,
  SUPPORTED_PRODUCT_CAPABILITIES,
} from "@exam/domain";
import { ProductProjectionProvider } from "@/contexts/ProductProjectionContext";
import type { ProductProjection } from "@/lib/productProjection";
import { QuestionForm, type QuestionFormData } from "./QuestionForm";

/**
 * W3.2 counterexamples (#678 / ADR-022 Phase 3): NEW-question authoring
 * offers only what the deployment's product projection admits. Under the
 * Minimal ceiling the type selector offers exactly Minimal's question types,
 * and the Rich prompt/option/answer slots are not offered at all — the form
 * never branches on the preset/presentation NAME (§6): the same rendered
 * logic is driven purely by `allows()` over the enabled set, so a bounded
 * Standard subset that re-enables a capability sees it again.
 *
 * Read/edit of EXISTING legacy material is not gated here (ADR-022 D5: a
 * disabled capability blocks NEW commitments only; the server write guard
 * stays the authority for updates).
 */

const minimalProjection: ProductProjection = {
  revision: 1,
  presentation: "minimal",
  enabled: [...MINIMAL_PRODUCT_CONFIGURATION.enabled],
};

const standardProjection: ProductProjection = {
  revision: 1,
  presentation: "standard",
  enabled: [...SUPPORTED_PRODUCT_CAPABILITIES],
};

function renderForm(projection: ProductProjection) {
  return render(
    <ProductProjectionProvider initialProjection={projection}>
      <QuestionForm courses={[]} onChange={vi.fn()} />
    </ProductProjectionProvider>,
  );
}

/** Formatted legacy rich document: bold mark → the lossy confirm fires. */
const LEGACY_RICH_DOC = {
  docVersion: 1 as const,
  type: "doc" as const,
  content: [
    {
      type: "paragraph" as const,
      content: [
        {
          type: "text" as const,
          text: "旧题富文本题干",
          marks: ["bold" as const],
        },
      ],
    },
  ],
};

function renderFormWithInitial(
  projection: ProductProjection,
  initial: Partial<QuestionFormData>,
) {
  const onChange = vi.fn();
  render(
    <ProductProjectionProvider initialProjection={projection}>
      <QuestionForm courses={[]} initial={initial} onChange={onChange} />
    </ProductProjectionProvider>,
  );
  return { onChange };
}

describe("QuestionForm authoring under the deployment ceiling (#678 W3.2)", () => {
  it("offers exactly Minimal's question types for a new question", async () => {
    const user = userEvent.setup();
    renderForm(minimalProjection);

    await user.click(screen.getByRole("combobox", { name: "题目类型" }));

    expect(screen.getByRole("option", { name: "单选题" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "判断题" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "文本作答题" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "多选题" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "填空题" }),
    ).not.toBeInTheDocument();
  });

  it("does not offer the Rich prompt mode when content.prompt.rich is disabled", async () => {
    const user = userEvent.setup();
    renderForm(minimalProjection);

    // The Plain↔Rich prompt toggle may be hidden entirely (Plain is the only
    // mode) or reduced to Plain-only; the contract is that Rich is never
    // offered. The plain textarea remains the content editor either way.
    const modeTrigger = screen.queryByRole("combobox", { name: "内容模式" });
    if (modeTrigger) {
      await user.click(modeTrigger);
      expect(
        screen.getByRole("option", { name: "纯文本" }),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("option", { name: "富文本" }),
    ).not.toBeInTheDocument();
    // The plain prompt editor (textarea) stays the content surface.
    expect(screen.getByPlaceholderText("输入题目内容")).toBeInTheDocument();
  });

  it("does not offer the rich answer mode when answer.text.rich is disabled", async () => {
    const user = userEvent.setup();
    renderForm(minimalProjection);

    await user.click(screen.getByRole("combobox", { name: "题目类型" }));
    await user.click(screen.getByRole("option", { name: "文本作答题" }));

    // Same contract for the answer mode: the selector may be omitted
    // entirely (plain is the only mode) or reduced to Plain-only; Rich is
    // never offered. Plain 简答 authoring (rubric) stays reachable.
    const answerTrigger = screen.queryByRole("combobox", { name: "作答模式" });
    if (answerTrigger) {
      await user.click(answerTrigger);
    }
    expect(
      screen.queryByRole("option", { name: "富文本" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the full Standard authoring surface when the deployment allows it", async () => {
    const user = userEvent.setup();
    renderForm(standardProjection);

    await user.click(screen.getByRole("combobox", { name: "题目类型" }));
    for (const label of [
      "单选题",
      "多选题",
      "填空题",
      "判断题",
      "文本作答题",
    ]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }

    // Close the modal select first: while a Radix Select is open the rest of
    // the tree is aria-hidden and invisible to role queries.
    await user.click(screen.getByRole("option", { name: "单选题" }));

    await user.click(screen.getByRole("combobox", { name: "内容模式" }));
    expect(screen.getByRole("option", { name: "富文本" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "纯文本" })).toBeInTheDocument();
  });
});

describe("QuestionForm legacy Rich downgrade under a closed Rich ceiling (#678 review)", () => {
  it("offers the explicit prompt Rich→Plain conversion for a legacy rich question and emits the eliminating edit", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFormWithInitial(minimalProjection, {
      type: "single_choice",
      content: "旧题富文本题干",
      contentDocument: LEGACY_RICH_DOC,
      options: [
        { id: "A", content: "0" },
        { id: "B", content: "1" },
      ],
    });

    // The downgrade entry is explicit (a labeled action, not a mode select
    // that would also imply the closed upgrade direction).
    const convert = screen.getByRole("button", { name: "转为纯文本" });
    await user.click(convert);

    // Formatted document → the lossy confirmation guards the downgrade.
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: "转换并丢弃格式" }),
    );

    // The eliminating edit: prompt document cleared, content carries the
    // plain projection — the one final material the write guard admits.
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contentDocument: null,
        content: "旧题富文本题干",
      }),
    );
    // The rich editor is replaced by the plain textarea surface.
    expect(screen.getByPlaceholderText("输入题目内容")).toBeInTheDocument();
  });

  it("offers the per-option Rich→Plain conversion for a legacy rich option", async () => {
    const user = userEvent.setup();
    const optionDoc = {
      docVersion: 1 as const,
      type: "doc" as const,
      content: [
        {
          type: "paragraph" as const,
          content: [{ type: "text" as const, text: "旧选项富文本" }],
        },
      ],
    };
    const { onChange } = renderFormWithInitial(minimalProjection, {
      type: "single_choice",
      content: "plain prompt",
      options: [
        { id: "A", content: "旧选项富文本", contentDocument: optionDoc },
        { id: "B", content: "1" },
      ],
    });

    await user.click(screen.getByRole("button", { name: "选项 A 转为纯文本" }));

    // Unformatted document → no lossy confirm, direct downgrade.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: [
          { id: "A", content: "旧选项富文本", contentDocument: null },
          { id: "B", content: "1" },
        ],
      }),
    );
  });

  it("offers the answerMode rich→plain conversion for a legacy rich-answer question, with no rich option offered", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFormWithInitial(minimalProjection, {
      type: "text_response",
      content: "旧富文本作答简答",
      answerMode: "rich",
      options: [],
      rubric: "按要点给分",
    });

    // The field stays present for the legacy rich answer mode with the
    // explicit conversion; the mode selector's 富文本 option is never
    // offered (upgrade direction closed).
    await user.click(screen.getByRole("button", { name: "转为纯文本作答" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ answerMode: "plain" }),
    );
    expect(
      screen.queryByRole("option", { name: "富文本" }),
    ).not.toBeInTheDocument();
  });

  it("offers no downgrade entry for a NEW plain question under Minimal (nothing to convert)", () => {
    renderForm(minimalProjection);
    expect(
      screen.queryByRole("button", { name: "转为纯文本" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "转为纯文本作答" }),
    ).not.toBeInTheDocument();
  });
});
