/**
 * Route-facts capture reproducibility lock (#764 R1-B).
 *
 * The Atlas snapshot takes the committed capture as an explicit build input
 * and hashes it (`route_facts_digest`), so the artifact must be what the
 * extractor actually produces from the current product tree — not a
 * hand-edited file that happens to parse. This test re-runs the real capture
 * (the same whole-application composition the CLI performs, no file writes)
 * and compares it with the committed artifact.
 *
 * `observed_head` is deliberately excluded from the comparison: it records the
 * revision the capture ran at, and the build's own precondition (`checkCapture`
 * in @exam/atlas) proves that revision is an ancestor of the observed revision
 * with no product-tree drift in between. Everything the capture *observes* —
 * the runtime surface, the declared registry mirror and the additional-gate
 * candidates — must still reproduce exactly.
 *
 * A drift here means the runtime surface moved: re-run
 * `pnpm --filter @exam/api atlas:capture-routes` and rebuild the snapshot.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureRouteFacts,
  detectAdditionalGateCandidates,
} from "./extractRouteFacts.js";

const ARTIFACT_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "atlas",
  "input",
  "route-facts.json",
);

interface RouteFactsArtifact {
  extractor: { id: string; version: string };
  observed_head: string;
  routes: Array<Record<string, unknown>>;
  registry: Array<Record<string, unknown>>;
  additional_gate_candidates: Array<Record<string, unknown>>;
}

describe("route-facts capture reproducibility (R1-B)", () => {
  it("reproduces the committed capture from the current product tree", async () => {
    const committed = JSON.parse(
      readFileSync(ARTIFACT_PATH, "utf8"),
    ) as RouteFactsArtifact;
    const { routes, registry } = await captureRouteFacts();
    const candidates = detectAdditionalGateCandidates();

    expect({
      routes,
      registry,
      additional_gate_candidates: candidates,
    }).toEqual({
      routes: committed.routes,
      registry: committed.registry,
      additional_gate_candidates: committed.additional_gate_candidates,
    });

    // Non-vacuity: the equality above is only meaningful over a real surface.
    expect(routes.length).toBeGreaterThan(0);
    expect(registry.length).toBeGreaterThan(0);
    expect(committed.observed_head).toMatch(/^[0-9a-f]{40}$/);
    expect(committed.extractor.id).toBe("@exam/api/atlas-route-facts");
  }, 240_000);
});
