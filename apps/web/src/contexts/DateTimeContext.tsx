import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { OrganizationSettingsDTO } from "@exam/contracts";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { canSeeSettings } from "@/lib/capabilities";
import {
  createFallbackDateTimeFormatter,
  createProductDateTimeFormatter,
  resolveProductTimeZone,
  type ProductDateTimeFormatter,
} from "@/lib/dateTime";

const fallback = createFallbackDateTimeFormatter();
const DateTimeContext = createContext<ProductDateTimeFormatter>(fallback);

export function DateTimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [organizationTimeZone, setOrganizationTimeZone] = useState<string>();
  const refresh = useCallback(async () => {
    if (!user || !canSeeSettings(user)) {
      setOrganizationTimeZone(undefined);
      return;
    }
    try {
      const settings = await api.get<Partial<OrganizationSettingsDTO>>(
        "/api/admin/settings",
      );
      setOrganizationTimeZone(settings.timezone ?? undefined);
    } catch {
      setOrganizationTimeZone(undefined);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
    window.addEventListener("branding:refresh", refresh);
    return () => window.removeEventListener("branding:refresh", refresh);
  }, [refresh]);

  const formatter = useMemo(
    () =>
      createProductDateTimeFormatter(
        resolveProductTimeZone(
          organizationTimeZone,
          import.meta.env.VITE_APP_TIMEZONE,
          fallback.timeZone,
        ),
      ),
    [organizationTimeZone],
  );

  return (
    <DateTimeContext.Provider value={formatter}>
      {children}
    </DateTimeContext.Provider>
  );
}

export function useProductDateTime(): ProductDateTimeFormatter {
  return useContext(DateTimeContext);
}
