import { describe, expect, it } from "vitest";
import {
  CONFIRMED_RECIPES,
  FONT_FAMILY_ROLES,
  isConfirmedRecipe,
} from "./typography-vocabulary";

describe("typography vocabulary (UI-VOCAB-1T)", () => {
  it("exposes every confirmed recipe declared in typography-vocabulary.md", () => {
    // The CONFIRMED roles from the authority document.
    expect(CONFIRMED_RECIPES).toEqual([
      "page-title",
      "page-description",
      "section-title",
      "body",
      "secondary",
      "metadata",
      "reading",
      "long-response",
      "metric",
      "metric-hero",
      "numeric",
      "code",
    ]);
  });

  it("has no duplicate recipe name (one public recipe per role)", () => {
    const names = CONFIRMED_RECIPES;
    expect(new Set(names).size).toBe(names.length);
  });

  it("rejects component-owned authorities from the typography recipe set", () => {
    // field-error and status are component authorities (FieldError, StatusBadge),
    // not typography recipes — they must NOT appear as type-* recipes.
    expect(isConfirmedRecipe("field-error")).toBe(false);
    expect(isConfirmedRecipe("status")).toBe(false);
    expect(isConfirmedRecipe("helper")).toBe(false); // merged into page-description
  });

  it("keeps font.reading and font.serif as distinct roles (reading != serif)", () => {
    expect(FONT_FAMILY_ROLES).toContain("font.reading");
    expect(FONT_FAMILY_ROLES).toContain("font.serif");
    expect(FONT_FAMILY_ROLES).toContain("font.ui");
    expect(FONT_FAMILY_ROLES).toContain("font.mono");
    // Distinct entries — serif is not aliased onto reading.
    expect(new Set(FONT_FAMILY_ROLES).size).toBe(FONT_FAMILY_ROLES.length);
  });

  it("typechecks recipe names", () => {
    expect(isConfirmedRecipe("metric")).toBe(true);
    expect(isConfirmedRecipe("not-a-role")).toBe(false);
  });
});
