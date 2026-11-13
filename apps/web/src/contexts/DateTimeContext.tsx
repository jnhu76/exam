import {
  createContext,
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
  const userId = user?.id ?? null;
  const [identityUserId, setIdentityUserId] = useState(userId);
  if (identityUserId !== userId) {
    // Identity switch (login/logout/user change): drop the previous
    // organization's zone during this render — before paint — so no
    // new-identity form can briefly display old-org times (#971 R9). The
    // effect below additionally strips superseded in-flight requests of
    // their write rights.
    setIdentityUserId(userId);
    setOrganizationTimeZone(undefined);
  }

  useEffect(() => {
    // One live owner per identity: any settings request launched for a
    // superseded identity can neither succeed-write nor fail-write into the
    // current context. The signal cancels the transport request itself.
    let live = true;
    const controller = new AbortController();

    const loadSettings = () => {
      if (!user || !canSeeSettings(user)) {
        setOrganizationTimeZone(undefined);
        return;
      }
      api
        .get<Partial<OrganizationSettingsDTO>>("/api/admin/settings", {
          signal: controller.signal,
        })
        .then((settings) => {
          if (live) setOrganizationTimeZone(settings.timezone ?? undefined);
        })
        .catch(() => {
          if (live) setOrganizationTimeZone(undefined);
        });
    };

    loadSettings();
    window.addEventListener("branding:refresh", loadSettings);
    return () => {
      live = false;
      controller.abort();
      window.removeEventListener("branding:refresh", loadSettings);
    };
  }, [user]);

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
