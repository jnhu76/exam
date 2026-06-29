import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BrandingView } from "@exam/domain";
import i18n from "@/i18n";
import { api } from "@/lib/api";

/**
 * Default branding sentinel — resolves from the default i18n instance so the
 * provider can reference it as a structural sentinel for override-detection
 * while keeping display copy in the catalog. The provider's `value` prop
 * overrides this; external config (orgDisplayName) also takes priority.
 */
const fallbackBranding: BrandingView = {
  get productName() {
    return i18n.t("branding.defaultName" as never);
  },
  get productSubtitle() {
    return i18n.t("branding.defaultDescription" as never);
  },
};

const BrandingContext = createContext<BrandingView>(fallbackBranding);

/**
 * Provides branding context (product name, subtitle) to the component tree.
 * Optionally fetches branding from the remote /api/settings/branding endpoint
 * and listens for branding:refresh events.
 */
export function BrandProvider({
  children,
  value = fallbackBranding,
  loadRemote = false,
  organizationDisplayName,
}: {
  children: ReactNode;
  value?: BrandingView;
  loadRemote?: boolean;
  organizationDisplayName?: string;
}) {
  const initialValue = useMemo(() => {
    if (organizationDisplayName && value === fallbackBranding) {
      return { ...value, productName: organizationDisplayName };
    }
    if (
      organizationDisplayName &&
      value.productName === fallbackBranding.productName
    ) {
      return { ...value, productName: organizationDisplayName };
    }
    return value;
  }, [organizationDisplayName, value]);
  const [branding, setBranding] = useState(initialValue);
  const refresh = useCallback(async () => {
    if (!loadRemote) return;
    try {
      setBranding(await api.get<BrandingView>("/api/settings/branding"));
    } catch {
      setBranding(initialValue);
    }
  }, [loadRemote, initialValue]);

  useEffect(() => {
    void refresh();
    window.addEventListener("branding:refresh", refresh);
    return () => window.removeEventListener("branding:refresh", refresh);
  }, [refresh]);

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  );
}

/** Hook to access the current branding context (product name, subtitle). */
export function useBranding(): BrandingView {
  return useContext(BrandingContext);
}
