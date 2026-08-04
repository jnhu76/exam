import { statusMeta } from "./statusMeta";

/**
 * J5-I1B Recovery Center — frontend status mapping.
 *
 * Wire shapes live canonically in `@exam/contracts` (`recovery.ts`) and are
 * imported from there by the Recovery pages and the projection hooks. This
 * module keeps ONLY the genuine UI-local helper that maps the incident wire
 * status to its `statusMeta` key — no DTO redeclaration (single wire
 * authority, no drift).
 */

/**
 * Maps the incident wire status (`open | investigating | resolved |
 * dismissed`) to its `statusMeta` key. Prefixed domain keys (`incidentOpen`,
 * …) exist because the bare `open` key is the exam lifecycle status — the
 * wire status string must never be fed to `getStatusMeta` directly.
 */
export function incidentStatusKey(status: string): keyof typeof statusMeta {
  switch (status) {
    case "open":
      return "incidentOpen";
    case "investigating":
      return "incidentInvestigating";
    case "resolved":
      return "incidentResolved";
    case "dismissed":
      return "incidentDismissed";
    default:
      return "unknown";
  }
}
