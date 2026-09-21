import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";
import { Button } from "./button";

/**
 * issue 582 D3 runtime ownership check: the 6px primary-control radius must own
 * the whole AlertDialog semantic family. Radix Slot propagates buttonVariants
 * classes, but the rendered elements expose the alert-dialog slot names
 * (child props win the data-slot merge) — so the frozen 6px Button geometry
 * (rounded-md → --radius-md = 0.375rem = 6px) must survive onto all three
 * semantic consumers, not just data-slot="button" elements.
 */
function renderConfirmScene() {
  return render(
    <AlertDialog open>
      <AlertDialogTrigger asChild>
        <Button>打开</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认操作</AlertDialogTitle>
          <AlertDialogDescription>确定要继续吗</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction>确认</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>,
  );
}

describe("AlertDialog consumes the 6px Button geometry (issue 582 D3)", () => {
  it("renders trigger/cancel/action with the Button radius class", () => {
    renderConfirmScene();

    for (const slot of [
      "alert-dialog-trigger",
      "alert-dialog-cancel",
      "alert-dialog-action",
    ] as const) {
      const el = document.querySelector(
        `[data-slot="${slot}"]`,
      ) as HTMLElement | null;
      expect(el, slot).not.toBeNull();
      expect(el).toHaveClass("rounded-md");
      expect(el).not.toHaveClass("rounded-lg");
    }
  });
});
