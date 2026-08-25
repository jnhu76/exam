import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TagFilterSelect } from "./TagFilterSelect";

function Wrapper() {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <TagFilterSelect
      tags={["代数", "几何"]}
      selected={selected}
      onChange={setSelected}
    />
  );
}

function trigger() {
  return document.querySelector(
    '[data-slot="tag-filter-trigger"]',
  ) as HTMLElement;
}

describe("TagFilterSelect", () => {
  // Issue #182: the toolbar must not jitter when the selection changes. The
  // trigger width is fixed below lg too (w-[180px]), shrinking only when the
  // container is narrower (max-w-full). A content-driven `w-auto` trigger
  // would resize as the selected label grows.
  it("keeps a stable trigger width regardless of selection", async () => {
    const user = userEvent.setup();
    render(<Wrapper />);

    const before = trigger().className;
    expect(before).toContain("w-[180px]");
    expect(before).not.toContain("w-auto");
    expect(before).not.toContain("lg:");

    await user.click(screen.getByRole("button", { name: "标签" }));
    await user.click(await screen.findByRole("checkbox", { name: "代数" }));

    // After selection the label changed but the width styling must not.
    expect(trigger().className).toBe(before);
  });
});
