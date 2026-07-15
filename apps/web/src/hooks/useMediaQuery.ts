import { useEffect, useState } from "react";

/**
 * SSR/jsdom-safe matchMedia hook. Returns `false` until a real `matchMedia`
 * reports a match, so server-rendered and jsdom environments default to the
 * mobile-first state. Components that need deterministic behavior in tests
 * must not branch rendering on this hook alone without a test-visible default
 * — used here only to select shell breakpoints where the underlying CSS would
 * also hide/show the right surfaces.
 *
 * @param query a CSS media query string, e.g. "(min-width: 64rem)".
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    // Sync in case the query result changed between init and effect.
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
