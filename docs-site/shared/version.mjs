/**
 * One source for the two independent SHAs the pilot must never conflate.
 *
 * - PRODUCT_SHA is the product-evidence commit the P1 product claims were
 *   verified against (a development state after v0.0.10).
 * - DOCS_SHA is the commit that actually contains the canonical documents
 *   (the P1 documentation commit — single-parent, not a merge). Source links
 *   must use it; PRODUCT_SHA does not contain docs/product/** or
 *   docs/guides/**.
 *
 * This module is imported by Node build scripts and by the VitePress client
 * theme, so it must stay dependency-free.
 */
export const PRODUCT_SHA = "511e6e60dd332f376f15ea0326f95fcefddaeb84";
export const DOCS_SHA = "41aa147ce6076bb1f94ceda415a893147f1b1599";

export const PRODUCT_SHA_SHORT = PRODUCT_SHA.slice(0, 8);
export const DOCS_SHA_SHORT = DOCS_SHA.slice(0, 8);
