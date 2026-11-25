import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ProductCapabilityId } from "@exam/domain";
import {
  fetchProductProjection,
  productAllows,
  type ProductProjection,
} from "@/lib/productProjection";

/**
 * Deployment product projection context (#678 / ADR-022 Phase 3).
 *
 * Fetches the public projection once per shell mount and exposes a
 * fail-closed `allows()` for pruning NEW-commitment authoring surfaces.
 * UX-only: the backend write guards stay the enforcement authority, and
 * obligation faces (pending manual grading, recovery, incident disposition,
 * result reads) MUST NOT consult this context at all — accepted work is
 * reachable under every ceiling (product-capability-composition.md §4.4).
 * Branching on the preset/presentation name is forbidden (§6).
 */
export interface ProductProjectionState {
  /** True once the projection has been fetched (successfully or not). */
  ready: boolean;
  /** The validated projection, or null when not loaded / fetch failed. */
  projection: ProductProjection | null;
  /**
   * Fail-closed capability verdict: false before the projection loads or
   * when the fetch failed — capability-scoped authoring stays unoffered
   * rather than guessing a wider ceiling.
   */
  allows: (capability: ProductCapabilityId) => boolean;
}

const ProductProjectionContext = createContext<ProductProjectionState>({
  ready: false,
  projection: null,
  allows: () => false,
});

export function ProductProjectionProvider({
  children,
  initialProjection,
}: {
  children: ReactNode;
  /** Test/deterministic injection; when absent the provider fetches once. */
  initialProjection?: ProductProjection;
}) {
  const [projection, setProjection] = useState<ProductProjection | null>(
    initialProjection ?? null,
  );
  const [ready, setReady] = useState(initialProjection !== undefined);

  useEffect(() => {
    if (initialProjection !== undefined) return;
    let cancelled = false;
    fetchProductProjection()
      .then((fetched) => {
        if (!cancelled) {
          setProjection(fetched);
          setReady(true);
        }
      })
      .catch(() => {
        // Fail-closed stays not-ready: optional authoring surfaces remain
        // unoffered; obligation faces never depend on this fetch.
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initialProjection]);

  const allows = useCallback(
    (capability: ProductCapabilityId) =>
      projection !== null && productAllows(projection, capability),
    [projection],
  );

  const value = useMemo(
    () => ({ ready, projection, allows }),
    [ready, projection, allows],
  );

  return (
    <ProductProjectionContext.Provider value={value}>
      {children}
    </ProductProjectionContext.Provider>
  );
}

export function useProductProjection(): ProductProjectionState {
  return useContext(ProductProjectionContext);
}
