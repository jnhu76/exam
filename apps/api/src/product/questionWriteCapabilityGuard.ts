import {
  deriveQuestionRequiredCapabilities,
  ValidationError,
  type ProductCapabilityId,
  type QuestionWriteMaterial,
} from "@exam/domain";
import { getResolvedProductConfiguration } from "./compositionRoot.js";

/**
 * ADR-022 Phase 2 authoritative question write guard (#678).
 *
 * Judges the FINAL material of a question create/update against the
 * deployment's resolved product ceiling (:254 "disabled capability rejected
 * at authoritative new-write boundaries"). This is a separate validation
 * boundary from the content write authority (`questionContent.ts` owns
 * content projection/normalization) and from actor authorization
 * (`Permission.*` / resource scope) — product capability, content rules and
 * actor authority are distinct authorities (ADR-022 D3) and each stays
 * enforced at its own seam.
 *
 * INVARIANT: call AFTER the merged final material has been resolved through
 * `resolveQuestionContentWrite` and BEFORE the repository write, so a
 * rejected command leaves no new content. Reads and deletes of legacy
 * incompatible content are deliberately NOT gated here (ADR-022 D5:
 * disabling a capability blocks NEW commitments only).
 *
 * The configuration is consulted per call through the canonical composition
 * root; there is no cached instance and no second resolver.
 */

/**
 * The single ceiling comparison behind every question write seam: the
 * required capabilities of the FINAL material that the current deployment
 * configuration does NOT admit, in stable catalog order. Throwing seams
 * (`assertQuestionWriteCapabilities`) and per-row seams (question import)
 * both consume this derivation, so no seam carries a second comparison.
 */
export function findQuestionWriteCapabilityViolations(
  material: QuestionWriteMaterial,
): readonly ProductCapabilityId[] {
  const required = deriveQuestionRequiredCapabilities(material);
  const resolved = getResolvedProductConfiguration();
  return required.filter((capability) => !resolved.allows(capability));
}

/**
 * Compatibility human text for a capability refusal. Non-authoritative
 * (the machine contract is the 400 VALIDATION_ERROR channel / the import
 * row's `status: "error"`, #417 C2); the wording names the ceiling and the
 * missing capabilities so operators can tell a capability refusal from a
 * schema validation failure.
 */
export function questionWriteCeilingViolationMessage(
  missing: readonly ProductCapabilityId[],
): string {
  return `question write exceeds the deployment product ceiling: ${missing.join(", ")}`;
}

export function assertQuestionWriteCapabilities(
  material: QuestionWriteMaterial,
): void {
  const missing = findQuestionWriteCapabilityViolations(material);
  if (missing.length > 0) {
    throw new ValidationError(questionWriteCeilingViolationMessage(missing));
  }
}
