/**
 * Single authority for WHERE governed business UI lives.
 *
 * Consumers: apps/web/eslint.config.ts (exam-ui rules scope) — each
 * consumer owns WHAT it enforces; this module owns only the canonical
 * root inventory, so a new business-UI root is registered once and every
 * consumer inherits it. INVARIANT: every immediate child directory of
 * apps/web/src/components except components/ui (generated shadcn
 * primitives) is governed business UI and must appear here, so a new
 * components/* subtree cannot silently escape governance.
 */
export const BUSINESS_UI_ROOTS = [
  "apps/web/src/pages",
  "apps/web/src/components/shared",
  "apps/web/src/components/exam",
  "apps/web/src/components/layout",
  "apps/web/src/components/settings",
  "apps/web/src/components/question",
  "apps/web/src/components/notifications",
  "apps/web/src/features",
];
