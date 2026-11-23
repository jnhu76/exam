import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  MINIMAL_PRODUCT_CONFIGURATION,
  SUPPORTED_PRODUCT_CAPABILITIES,
} from "@exam/domain";
import { ProductProjectionProvider } from "@/contexts/ProductProjectionContext";
import type { ProductProjection } from "@/lib/productProjection";
import { QuestionForm } from "./QuestionForm";

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
