import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { BrandingView } from "@exam/domain";
import { api } from "@/lib/api";

const fallbackBranding: BrandingView = {
  productName: "考试平台",
  productSubtitle: "内部考核与准入控制",
};

const BrandingContext = createContext<BrandingView>(fallbackBranding);

export function BrandProvider({
  children,
  value = fallbackBranding,
  loadRemote = false,
}: {
  children: ReactNode;
  value?: BrandingView;
  loadRemote?: boolean;
}) {
  const [branding, setBranding] = useState(value);
  const refresh = useCallback(async () => {
    if (!loadRemote) return;
    try {
      setBranding(await api.get<BrandingView>("/api/settings/branding"));
    } catch {
      setBranding(value);
    }
  }, [loadRemote, value]);

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

export function useBranding(): BrandingView {
  return useContext(BrandingContext);
}
