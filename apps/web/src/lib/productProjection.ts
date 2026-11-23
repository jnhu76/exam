import {
  ProductCapabilityProjectionSchema,
  PublicConfigResponseSchema,
  type ProductCapabilityProjection,
} from "@exam/contracts";
import type { ProductCapabilityId } from "@exam/domain";
import { api } from "@/lib/api";

/**
 * The deployment's public product projection (#678 / ADR-022 Phase 3,
 * GET /api/system/public-config — unauthenticated, non-sensitive).
 *
 * `enabled` answers ONLY "may this deployment make a NEW commitment of this
 * capability?". It is NOT actor authorization (Permission / resource scope
 * stay separate authorities), NOT per-exam policy (a frozen
 * `controlFlags.requireQueue` drives the candidate queue regardless), and
 * NOT an obligation statement: accepted work (pending manual grading,
 * recovery, incident disposition, historical Rich reads) stays reachable
 * regardless of this projection — UI consumers MUST NOT gate it here.
 *
 * Consumers prune with {@link productAllows}; branching on the
 * `presentation`/preset NAME is forbidden (product-capability-composition.md
 * §6). The backend write guards stay the enforcement authority — this is a
 * UX-only projection.
 */
export type ProductProjection = ProductCapabilityProjection;

export async function fetchProductProjection(): Promise<ProductProjection> {
  // The response is validated fail-closed: a body without a well-formed
  // product projection rejects instead of degrading into a guessed ceiling.
  const config = PublicConfigResponseSchema.parse(
    await api.get<unknown>("/api/system/public-config"),
  );
  return ProductCapabilityProjectionSchema.parse(config.product);
}

export function productAllows(
  projection: ProductProjection,
  capability: ProductCapabilityId,
): boolean {
  return projection.enabled.includes(capability);
}
