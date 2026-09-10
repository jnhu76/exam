/**
 * Single runtime authority for the docs surface path identity (I6/I11).
 *
 * API_REFERENCE_UI_PATH is the one canonical docs namespace root. Every
 * other docs path string in runtime code derives from it: the Fastify
 * docs-surface registration (openapi/registerDocs.ts), the swagger-ui
 * routePrefix, the machine-readable spec projection
 * (config/runtimeConfig.ts -> buildPublicConfig), and the architecture
 * gates (routes/httpSurfaceAuthority.test.ts). There is no second place
 * that authors a docs path independently.
 */
export const API_REFERENCE_UI_PATH = "/_dev/api-reference";

/** The machine-readable spec route @fastify/swagger-ui registers under the
 * UI path (`{uiPath}/json`). Derived, never independently authored. */
export const API_REFERENCE_SPEC_PATH = `${API_REFERENCE_UI_PATH}/json`;
