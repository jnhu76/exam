import { describe, expect, it } from "vitest";
import {
  STANDARD_PRODUCT_CONFIGURATION,
  SUPPORTED_PRODUCT_CAPABILITIES,
  resolveDeploymentProductConfiguration,
  type ProductCapabilityId,
} from "./productCapabilities.js";

/**
 * W3.1 counterexamples (ADR-022 Phase 3 #678): the Minimal preset is an
 * ACCEPTED static deployment configuration (ADR-022 "Presets accepted for
 * initial design" + product-capability-composition.md §10), so the SAME
 * fail-closed resolver that owns Standard must resolve it. These tests pin
 * the resolver contract for the minimal preset vocabulary; they deliberately
 * use an inline configuration literal (not a new export) so the failure
 * points at the resolver's preset/presentation vocabulary, which is the
 * missing capability under test.
 *
 * Enabled-set ruling (product-capability-composition.md §10 table + ADR-022
 * preset section): Minimal = single_choice, true_false, Plain text_response
 * + basic manual grading (§5 dependency), account admission (identity row:
 * "当前 Account + Candidate"), existing result publication authority.
 * NOT enabled: multiple_choice ("可批准" = opt-in), fill_blank (not listed),
 * the three Rich slots ("默认 Plain；不要求 Rich editor"), admission.queue
 * ("默认不要求 queue"), operator.monitoring ("不要求数字监考"). Pending
 * manual/recovery/incident work stays reachable regardless — that is a
 * presentation/kernel obligation (§4.4), not an entry in this set.
 */
const MINIMAL_ENABLED: readonly ProductCapabilityId[] = [
  "question.single_choice",
  "question.true_false",
  "question.text_response",
  "grading.manual",
  "admission.account",
  "result.publication",
];

const MINIMAL_DEPLOYMENT = {
  preset: "minimal",
  revision: 1,
  presentation: "minimal",
  enabled: MINIMAL_ENABLED,
} as const;

describe("ADR-022 Phase 3 — Minimal preset through the same resolver", () => {
  it("resolves the Minimal deployment configuration", () => {
    const resolved = resolveDeploymentProductConfiguration(MINIMAL_DEPLOYMENT);
    expect(resolved.revision).toBe(1);
    expect(resolved.presentation).toBe("minimal");
    // Catalog-order projection of the Minimal default set, independent of
    // caller ordering.
    expect(resolved.enabled).toEqual(MINIMAL_ENABLED);
  });

  it("keeps Minimal inside the closed catalog with a subset projection", () => {
    const resolved = resolveDeploymentProductConfiguration(MINIMAL_DEPLOYMENT);
    for (const capability of resolved.enabled) {
      expect(SUPPORTED_PRODUCT_CAPABILITIES).toContain(capability);
    }
    expect(resolved.enabled.length).toBeLessThan(
      SUPPORTED_PRODUCT_CAPABILITIES.length,
    );
  });

  it("allows the Minimal set and refuses everything outside it", () => {
    const resolved = resolveDeploymentProductConfiguration(MINIMAL_DEPLOYMENT);
    for (const capability of MINIMAL_ENABLED) {
      expect(resolved.allows(capability)).toBe(true);
    }
    for (const disabled of [
      "question.multiple_choice",
      "question.fill_blank",
      "content.prompt.rich",
      "content.option.rich",
      "answer.text.rich",
      "admission.queue",
      "operator.monitoring",
    ] as const satisfies readonly ProductCapabilityId[]) {
      expect(resolved.allows(disabled)).toBe(false);
    }
  });

  it("normalizes caller ordering for the Minimal set", () => {
    const resolved = resolveDeploymentProductConfiguration({
      ...MINIMAL_DEPLOYMENT,
      enabled: [...MINIMAL_ENABLED].reverse(),
    });
    expect(resolved.enabled).toEqual(MINIMAL_ENABLED);
  });

  it("stays fail-closed under the Minimal preset", () => {
    // Unknown/future capability names never resolve, whatever the preset.
    expect(() =>
      resolveDeploymentProductConfiguration({
        ...MINIMAL_DEPLOYMENT,
        enabled: [...MINIMAL_ENABLED, "admission.federated"],
      }),
    ).toThrow("Unknown or future");
    expect(() =>
      resolveDeploymentProductConfiguration({
        ...MINIMAL_DEPLOYMENT,
        enabled: [...MINIMAL_ENABLED, "question.single_choice"],
      }),
    ).toThrow("Duplicate");
    // §5: subjective questions still require their manual completion path.
    expect(() =>
      resolveDeploymentProductConfiguration({
        ...MINIMAL_DEPLOYMENT,
        enabled: MINIMAL_ENABLED.filter((c) => c !== "grading.manual"),
      }),
    ).toThrow(/grading\.manual/);
    // Unknown fields and unshipped preset vocabulary stay rejected.
    expect(() =>
      resolveDeploymentProductConfiguration({
        ...MINIMAL_DEPLOYMENT,
        enableAll: true,
      }),
    ).toThrow();
    expect(() =>
      resolveDeploymentProductConfiguration({
        ...MINIMAL_DEPLOYMENT,
        preset: "simple",
      }),
    ).toThrow();
  });

  it("pairs each preset with its canonical presentation", () => {
    // A "minimal" preset claiming Standard presentation (or the reverse) is
    // an incoherent deployment configuration and fails closed.
    expect(() =>
      resolveDeploymentProductConfiguration({
        ...MINIMAL_DEPLOYMENT,
        presentation: "standard",
      }),
    ).toThrow();
    expect(() =>
      resolveDeploymentProductConfiguration({
        ...STANDARD_PRODUCT_CONFIGURATION,
        presentation: "minimal",
      }),
    ).toThrow();
  });

  it("returns an immutable Minimal resolution and leaves Standard untouched", () => {
    const resolved = resolveDeploymentProductConfiguration(MINIMAL_DEPLOYMENT);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.enabled)).toBe(true);
    expect(Object.keys(resolved).sort()).toEqual([
      "allows",
      "enabled",
      "presentation",
      "revision",
    ]);
    // Behavior-equivalence gate (ADR-022 :252): resolving Minimal must not
    // disturb the Standard configuration or the full-catalog resolution.
    expect(STANDARD_PRODUCT_CONFIGURATION.enabled).toEqual(
      SUPPORTED_PRODUCT_CAPABILITIES,
    );
    const standard = resolveDeploymentProductConfiguration(
      STANDARD_PRODUCT_CONFIGURATION,
    );
    expect(standard.enabled).toEqual(SUPPORTED_PRODUCT_CAPABILITIES);
    expect(standard.presentation).toBe("standard");
  });
});
