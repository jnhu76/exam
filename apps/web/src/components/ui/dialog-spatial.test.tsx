import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  type DialogSize,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Dialog spatial vocabulary tests (P3 §12 dialog contract, issue 459).
 *
 *   - ONE size vocabulary sm(384)/md(512, default)/lg(672) on BOTH
 *     DialogContent and AlertDialogContent (the 320px alert-dialog tier is
 *     retired);
 *   - Content carries the max-height contract (85dvh) and is a flex column so
 *     the data-slot="dialog-body" region can own vertical scrolling with
 *     fixed header/footer;
 *   - xl (896) is intentionally absent (documented extension rule only).
 */

const SIZE_TO_MAX_W: Record<DialogSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
};

const here = dirname(fileURLToPath(import.meta.url));

function renderDialog(size?: DialogSize) {
  render(
    <Dialog open>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>对话框</DialogTitle>
        </DialogHeader>
      </DialogContent>
    </Dialog>,
  );
  return screen.getByRole("dialog");
}

function renderAlertDialog(size?: "sm" | "md" | "lg") {
  render(
    <AlertDialog open>
      <AlertDialogContent size={size}>
        <AlertDialogHeader>
          <AlertDialogTitle>确认框</AlertDialogTitle>
        </AlertDialogHeader>
      </AlertDialogContent>
    </AlertDialog>,
  );
  return screen.getByRole("alertdialog");
}

describe("dialog size vocabulary", () => {
  it("defaults to md (512) on DialogContent", () => {
    const content = renderDialog();
    expect(content).toHaveAttribute("data-size", "md");
    expect(content).toHaveClass(SIZE_TO_MAX_W.md);
  });

  it.each(["sm", "md", "lg"] as const)(
    "maps DialogContent size=%s to its contract width",
    (size) => {
      const content = renderDialog(size);
      expect(content).toHaveAttribute("data-size", size);
      expect(content).toHaveClass(SIZE_TO_MAX_W[size]);
    },
  );

  it.each(["sm", "md", "lg"] as const)(
    "exposes the same vocabulary on AlertDialogContent size=%s",
    (size) => {
      const content = renderAlertDialog(size);
      expect(content).toHaveAttribute("data-size", size);
      expect(content).toHaveClass(SIZE_TO_MAX_W[size]);
    },
  );

  it("defaults AlertDialogContent to md (512), retiring the 320px tier", () => {
    const content = renderAlertDialog();
    expect(content).toHaveAttribute("data-size", "md");
    expect(content).toHaveClass("sm:max-w-lg");
    expect(content).not.toHaveClass("max-w-xs");
  });

  it("caps both contents at 85dvh as flex columns (body-scroll ownership)", () => {
    expect(renderDialog()).toHaveClass("max-h-[85dvh]", "flex", "flex-col");
    expect(renderAlertDialog()).toHaveClass(
      "max-h-[85dvh]",
      "flex",
      "flex-col",
    );
  });

  it("keeps mobile full-width-with-margins as the base behavior", () => {
    expect(renderDialog()).toHaveClass("w-full", "max-w-[calc(100%-2rem)]");
    expect(renderAlertDialog()).toHaveClass(
      "w-full",
      "max-w-[calc(100%-2rem)]",
    );
  });

  it("implements the dialog-body scroll convention in the shared CSS", () => {
    // The convention is a data-slot contract (no wrapper component); the
    // scroll ownership must live in the shared surface recipes, not in
    // per-dialog utilities.
    const css = readFileSync(
      join(here, "../../surface/recipes.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\[data-slot="dialog-body"\]\s*\{[^}]*overflow-y:\s*auto/,
    );
    expect(css).toMatch(
      /\[data-slot="dialog-body"\]\s*\{[^}]*min-height:\s*0/,
    );
  });
});
