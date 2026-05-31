import { createContext, useContext, type ReactNode } from "react";
import type { BrandingView } from "@exam/domain";

const fallbackBranding: BrandingView = {
  productName: "内网考试平台",
  productSubtitle: "机构内部测评与准入认证",
};

const BrandingContext = createContext<BrandingView>(fallbackBranding);

export function BrandProvider({
  children,
  value = fallbackBranding,
}: {
  children: ReactNode;
  value?: BrandingView;
}) {
  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): BrandingView {
  return useContext(BrandingContext);
}
