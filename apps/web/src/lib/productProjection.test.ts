import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MINIMAL_PRODUCT_CONFIGURATION,
  SUPPORTED_PRODUCT_CAPABILITIES,
} from "@exam/domain";
import {
  fetchProductProjection,
  productAllows,
  type ProductProjection,
} from "./productProjection";

/**
 * W3.2 counterexamples (#678 / ADR-022 Phase 3): the web shell consumes the
 * deployment's public product projection (GET /system/public-config) through
 * ONE typed surface. Consumers prune NEW-commitment authoring with
 * `productAllows` — never by preset/presentation name (§6) — and obligation
 * faces never consult it at all. The projection answers "may this deployment
 * make a NEW commitment of this capability?"; it grants no permissions and
 * says nothing about accepted obligations.
 */

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
}));

const minimalProjection: ProductProjection = {
  revision: 1,
  presentation: "minimal",
  enabled: [...MINIMAL_PRODUCT_CONFIGURATION.enabled],
};

afterEach(() => {
  apiGet.mockReset();
});

describe("public-config product projection consumption (#678 W3.2)", () => {
  it("fetches /system/public-config and returns the validated product projection", async () => {
    apiGet.mockResolvedValueOnce({
      deploymentMode: "singleTenant",
      features: { apiReference: false },
      apiReference: {
        enabled: false,
        uiPath: "/api/docs",
        specPath: "/api/docs/json",
      },
      product: { ...minimalProjection },
    });

    const projection = await fetchProductProjection();

    expect(apiGet).toHaveBeenCalledWith("/api/system/public-config");
    expect(projection.revision).toBe(1);
    expect(projection.presentation).toBe("minimal");
    expect(projection.enabled).toEqual([
      ...MINIMAL_PRODUCT_CONFIGURATION.enabled,
    ]);
  });

  it("rejects a response without a well-formed product projection (fail-closed)", async () => {
    apiGet.mockResolvedValueOnce({ deploymentMode: "singleTenant" });
    await expect(fetchProductProjection()).rejects.toThrow();
  });

  it("derives allows() from enabled membership, unknown names fail closed", () => {
    for (const capability of MINIMAL_PRODUCT_CONFIGURATION.enabled) {
      expect(productAllows(minimalProjection, capability)).toBe(true);
    }
    for (const disabled of [
      "question.multiple_choice",
      "question.fill_blank",
      "content.prompt.rich",
      "content.option.rich",
      "answer.text.rich",
      "admission.queue",
      "operator.monitoring",
    ] as const) {
      expect(productAllows(minimalProjection, disabled)).toBe(false);
    }
    // Unknown/future names never slip through any projection.
    expect(
      productAllows(minimalProjection, "admission.federated" as never),
    ).toBe(false);
  });

  it("an all-disabled projection allows nothing; the full Standard catalog allows everything", () => {
    const allDisabled: ProductProjection = {
      revision: 1,
      presentation: "standard",
      enabled: [],
    };
    for (const capability of SUPPORTED_PRODUCT_CAPABILITIES) {
      expect(productAllows(allDisabled, capability)).toBe(false);
    }
    const standard: ProductProjection = {
      revision: 1,
      presentation: "standard",
      enabled: [...SUPPORTED_PRODUCT_CAPABILITIES],
    };
    for (const capability of SUPPORTED_PRODUCT_CAPABILITIES) {
      expect(productAllows(standard, capability)).toBe(true);
    }
  });
});
