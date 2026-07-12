import { describe, expect, it } from "vitest";
import {
  CONFIRMED_DENSITIES,
  isConfirmedDensity,
  type DensityRecipeName,
} from "./density-vocabulary";

/**
 * Structural tests for the semantic density vocabulary (UI-SURFACE-1 §6).
 *
 * Density is information density (how tightly a region packs content), NOT
 * raw padding values. Per the surface vocabulary, component layout owns the
 * exact padding/gap within its density role — so density is a VOCABULARY
 * (names + ranges), not a set of CSS classes. A `density-compact` class
 * would falsely pin a single value where the role legitimately spans p-3/p-4.
 *
 * These tests assert the vocabulary mirror is the documented authority: the
 * three confirmed roles, and the absence of rejected fine-grained variants.
 */
describe("density vocabulary (UI-SURFACE-1 §6)", () => {
  it("confirms exactly the three information-density tiers", () => {
    expect(CONFIRMED_DENSITIES).toEqual(["compact", "default", "comfortable"]);
  });

  it("isConfirmedDensity narrows only confirmed roles", () => {
    expect(isConfirmedDensity("compact")).toBe(true);
    expect(isConfirmedDensity("default")).toBe(true);
    expect(isConfirmedDensity("comfortable")).toBe(true);
    // Rejected fine-grained / component-named variants.
    expect(isConfirmedDensity("p4")).toBe(false);
    expect(isConfirmedDensity("p5")).toBe(false);
    expect(isConfirmedDensity("card")).toBe(false);
    expect(isConfirmedDensity("table")).toBe(false);
  });

  it("exposes the type for compile-time authority", () => {
    const d: DensityRecipeName = "compact";
    expect(CONFIRMED_DENSITIES).toContain(d);
  });
});
