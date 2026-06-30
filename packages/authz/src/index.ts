/**
 * @exam/authz — Phase 3 Scoped RBAC catalog & mapping.
 *
 * Leaf package: no fastify/React/Drizzle (enforced by `scripts/check-architecture.mjs`).
 * May depend only on `@exam/domain` for legacy types.
 */
export * from "./catalog.js";
export * from "./legacyMap.js";
export * from "./presets.js";
export * from "./auditActions.js";
export * from "./resolver.js";
