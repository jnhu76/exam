import { describe, expect, it } from "vitest";
import {
  SUPPORTED_PRODUCT_CAPABILITIES,
  STANDARD_PRODUCT_CONFIGURATION,
  resolveDeploymentProductConfiguration,
  type ProductCapabilityId,
} from "./productCapabilities.js";

describe("ADR-022 Phase 1 — Standard product resolver", () => {
  it("enumerates the current Standard catalog without future promises", () => {
    expect(SUPPORTED_PRODUCT_CAPABILITIES).toEqual([
      "question.single_choice",
      "question.multiple_choice",
      "question.true_false",
      "question.fill_blank",
      "question.text_response",
      "content.prompt.rich",
      "content.option.rich",
      "answer.text.rich",
      "grading.manual",
      "admission.account",
      "admission.queue",
      "result.publication",
      "operator.monitoring",
    ]);
    expect(SUPPORTED_PRODUCT_CAPABILITIES).not.toContain("admission.federated");
    expect(SUPPORTED_PRODUCT_CAPABILITIES).not.toContain("proctor.camera");
    expect(SUPPORTED_PRODUCT_CAPABILITIES).not.toContain("delivery.offline");
  });

  it("preserves Standard and Plain subjective/manual grading", () => {
    const resolved = resolveDeploymentProductConfiguration(
      STANDARD_PRODUCT_CONFIGURATION,
    );
    expect(resolved.revision).toBe(1);
    expect(resolved.presentation).toBe("standard");
    expect(resolved.enabled).toEqual(SUPPORTED_PRODUCT_CAPABILITIES);
    for (const capability of SUPPORTED_PRODUCT_CAPABILITIES) {
      expect(resolved.allows(capability)).toBe(true);
    }
    // Unknown/future names never enter the typed allows() seam. Rejection is
    // proven through the resolver's `unknown` boundary below.
    expect(resolved.allows("question.text_response")).toBe(true);
    expect(resolved.allows("grading.manual")).toBe(true);
  });

  it("normalizes ordering without changing the resolved capability set", () => {
    const reordered = resolveDeploymentProductConfiguration({
      ...STANDARD_PRODUCT_CONFIGURATION,
      enabled: [...SUPPORTED_PRODUCT_CAPABILITIES].reverse(),
    });
    expect(reordered.enabled).toEqual(SUPPORTED_PRODUCT_CAPABILITIES);
  });

  it("rejects unknown and future capabilities", () => {
    const futureNames = [
      "admission.federated",
      "proctor.camera",
      "delivery.offline",
    ];
    for (const invalid of futureNames) {
      expect(() =>
        resolveDeploymentProductConfiguration({
          ...STANDARD_PRODUCT_CONFIGURATION,
          enabled: [...SUPPORTED_PRODUCT_CAPABILITIES, invalid],
        }),
      ).toThrow("Unknown or future");
    }
  });

  it("refuses duplicate capabilities and invalid input structure", () => {
    expect(() =>
      resolveDeploymentProductConfiguration({
        ...STANDARD_PRODUCT_CONFIGURATION,
        enabled: [...SUPPORTED_PRODUCT_CAPABILITIES, "question.single_choice"],
      }),
    ).toThrow("Duplicate");
    expect(() => resolveDeploymentProductConfiguration(null)).toThrow();
    expect(() => resolveDeploymentProductConfiguration([])).toThrow();
    expect(() =>
      resolveDeploymentProductConfiguration({
        ...STANDARD_PRODUCT_CONFIGURATION,
        enabled: "question.single_choice",
      }),
    ).toThrow();
  });

  it("rejects unshipped presets, revisions and unknown fields", () => {
    for (const rejected of [
      { ...STANDARD_PRODUCT_CONFIGURATION, preset: "minimal" },
      { ...STANDARD_PRODUCT_CONFIGURATION, preset: "simple" },
      { ...STANDARD_PRODUCT_CONFIGURATION, revision: 2 },
      { ...STANDARD_PRODUCT_CONFIGURATION, presentation: "minimal" },
      { ...STANDARD_PRODUCT_CONFIGURATION, enableAll: true },
    ]) {
      expect(() => resolveDeploymentProductConfiguration(rejected)).toThrow();
    }
  });

  it("returns immutable resolved configuration", () => {
    const resolved = resolveDeploymentProductConfiguration(
      STANDARD_PRODUCT_CONFIGURATION,
    );
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.enabled)).toBe(true);
    expect(Object.keys(resolved).sort()).toEqual([
      "allows",
      "enabled",
      "presentation",
      "revision",
    ]);
  });
});

/**
 * ADR-022 Phase 2: with the authoritative write guards in place, a bounded
 * subset of Standard is a legal deployment configuration. This describe
 * supersedes the Phase 1 contract "partial configurations require
 * authoritative write guards", which was removed once the guards existed
 * (question write boundary); the fail-closed surface above (unknown/
 * duplicate/structure) is unchanged.
 */
describe("ADR-022 Phase 2 — guarded bounded configurations", () => {
  /** Standard minus the capabilities the guard tests disable. */
  const BOUNDED_SUBSET: readonly ProductCapabilityId[] =
    SUPPORTED_PRODUCT_CAPABILITIES.filter(
      (capability) =>
        capability !== "question.multiple_choice" &&
        capability !== "content.prompt.rich" &&
        capability !== "content.option.rich" &&
        capability !== "answer.text.rich",
    );

  it("resolves a subset of Standard into a bounded ceiling", () => {
    const resolved = resolveDeploymentProductConfiguration({
      ...STANDARD_PRODUCT_CONFIGURATION,
      enabled: BOUNDED_SUBSET,
    });
    expect(resolved.revision).toBe(1);
    expect(resolved.presentation).toBe("standard");
    expect(resolved.allows("question.single_choice")).toBe(true);
    expect(resolved.allows("question.text_response")).toBe(true);
    expect(resolved.allows("grading.manual")).toBe(true);
    expect(resolved.allows("question.multiple_choice")).toBe(false);
    expect(resolved.allows("content.prompt.rich")).toBe(false);
    expect(resolved.allows("content.option.rich")).toBe(false);
    expect(resolved.allows("answer.text.rich")).toBe(false);
  });

  it("projects enabled as the validated subset in catalog order", () => {
    // Caller ordering is normalized away, and the projection is the SUBSET —
    // returning the full catalog for a bounded configuration would present a
    // disabled capability as effective (the lie Phase 1's resolver comment
    // warns about).
    const resolved = resolveDeploymentProductConfiguration({
      ...STANDARD_PRODUCT_CONFIGURATION,
      enabled: [...BOUNDED_SUBSET].reverse(),
    });
    expect(resolved.enabled).toEqual(BOUNDED_SUBSET);
    expect(resolved.enabled).not.toEqual(SUPPORTED_PRODUCT_CAPABILITIES);
    for (const capability of SUPPORTED_PRODUCT_CAPABILITIES) {
      expect(resolved.allows(capability)).toBe(
        BOUNDED_SUBSET.includes(capability),
      );
    }
  });

  it("keeps the Standard full catalog projection unchanged", () => {
    // Behavior-equivalence gate (ADR-022 :252): the full-Standard resolution
    // keeps projecting the entire catalog in catalog order.
    const resolved = resolveDeploymentProductConfiguration(
      STANDARD_PRODUCT_CONFIGURATION,
    );
    expect(resolved.enabled).toEqual(SUPPORTED_PRODUCT_CAPABILITIES);
  });

  it("rejects question.text_response without its manual completion path", () => {
    // product-capability-composition.md §5: 不能开启主观题却关闭其 completion
    // path. The failure must name the missing dependency, not the generic
    // partial-configuration guard.
    expect(() =>
      resolveDeploymentProductConfiguration({
        ...STANDARD_PRODUCT_CONFIGURATION,
        enabled: SUPPORTED_PRODUCT_CAPABILITIES.filter(
          (capability) =>
            capability !== "grading.manual" &&
            capability !== "content.prompt.rich" &&
            capability !== "content.option.rich" &&
            capability !== "answer.text.rich",
        ),
      }),
    ).toThrow(/grading\.manual/);
  });

  it("accepts an empty bounded configuration with every capability disabled", () => {
    // An all-disabled deployment is legal: the semantic kernel (lifecycle,
    // grading, result authority, operator work) is not a product capability,
    // and the write boundaries reject every NEW product commitment.
    const resolved = resolveDeploymentProductConfiguration({
      ...STANDARD_PRODUCT_CONFIGURATION,
      enabled: [],
    });
    expect(resolved.enabled).toEqual([]);
    for (const capability of SUPPORTED_PRODUCT_CAPABILITIES) {
      expect(resolved.allows(capability)).toBe(false);
    }
  });
});
