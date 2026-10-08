import { describe, expect, it, vi } from "vitest";

/**
 * #689 transitive edge: API -> @exam/contracts -> @exam/domain.
 * A direct API alias alone is not enough if a package is externalized
 * by the Vitest runtime and Node loads domain/dist behind Vite's back.
 *
 * The mocked domain export is a hostile input. We import the REAL
 * @exam/contracts entry afterward and observe its public Zod contract,
 * rather than only checking that the alias string appears in the config.
 */
vi.mock("@exam/domain", async (importOriginal) => {
  const source = await importOriginal<typeof import("@exam/domain")>();
  return {
    ...source,
    NOTIFICATION_TYPES: [
      ...source.NOTIFICATION_TYPES,
      "__issue_689_transitive_domain_probe__",
    ],
  };
});

describe("direct Vitest transitive domain source resolution (api)", () => {
  it("routes @exam/contracts' runtime @exam/domain dependency through Vitest", async () => {
    const { NotificationTypeSchema } = await import("@exam/contracts");

    expect(NotificationTypeSchema.options).toContain(
      "__issue_689_transitive_domain_probe__",
    );
  });
});
