import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined") {
  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  }
  if (!window.HTMLElement.prototype.setPointerCapture) {
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
  }
  if (!window.HTMLElement.prototype.releasePointerCapture) {
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  }
  if (!HTMLAnchorElement.prototype.click) {
    HTMLAnchorElement.prototype.click = vi.fn();
  }
}

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => "blob:mock");
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
}

afterEach(() => {
  cleanup();
});
