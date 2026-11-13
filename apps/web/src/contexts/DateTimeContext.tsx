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

interface DateTimeContextValue {
  formatter: ProductDateTimeFormatter;
  /**
   * Whether the current identity's first organization-settings read has
   * settled (or no read is needed because the identity cannot see settings).
   * Scheduling forms keep their inputs closed until this is true, so a late
   * settings response can never change the zone under already-entered wall
   * clocks (#971 F-20 review A).
   */
  settingsSettled: boolean;
}

const DateTimeContext = createContext<DateTimeContextValue>({
  formatter: fallback,
  settingsSettled: true,
});

export function DateTimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [organizationTimeZone, setOrganizationTimeZone] = useState<string>();
  const userId = user?.id ?? null;
  const needsSettingsRead = user != null && canSeeSettings(user);
  const [identityUserId, setIdentityUserId] = useState(userId);
  const [settingsSettled, setSettingsSettled] = useState(!needsSettingsRead);
  if (identityUserId !== userId) {
    // Identity switch (login/logout/user change): drop the previous
    // organization's zone and re-close scheduling inputs during this render
    // — before paint — so no new-identity form can briefly display or accept
    // old-org times (#971 R9). The effect below additionally strips
    // superseded in-flight requests of their write rights.
    setIdentityUserId(userId);
    setOrganizationTimeZone(undefined);
    setSettingsSettled(!needsSettingsRead);
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
        if (live) setSettingsSettled(true);
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
        })
        .finally(() => {
          // First-read settlement only ever moves forward: a later branding
          // refresh must not close an already-open scheduling session.
          if (live) setSettingsSettled(true);
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

  const value = useMemo<DateTimeContextValue>(
    () => ({
      formatter: createProductDateTimeFormatter(
        resolveProductTimeZone(
          organizationTimeZone,
          import.meta.env.VITE_APP_TIMEZONE,
          fallback.timeZone,
        ),
      ),
      settingsSettled,
    }),
    [organizationTimeZone, settingsSettled],
  );

  return (
    <DateTimeContext.Provider value={value}>
      {children}
    </DateTimeContext.Provider>
  );
}

export function useProductDateTime(): ProductDateTimeFormatter {
  return useContext(DateTimeContext).formatter;
}

/**
 * The scheduling zone for ONE form session (#971 F-20 review A): null until
 * the first organization-settings read for the current identity settles, then
 * the resolved product zone frozen for the lifetime of that session.
 *
 * Input, prefill, confirmation, validation and submit must all consume this
 * value — never the live formatter zone, which a branding refresh can move.
 * An identity switch drops the frozen zone during render, so a superseded
 * identity's late success or failure cannot reopen it (#971 R9).
 */
export function useScheduleSessionTimeZone(): string | null {
  const { formatter, settingsSettled } = useContext(DateTimeContext);
  const { user } = useAuth();
  const identity = user?.id ?? null;
  const [session, setSession] = useState<{
    identity: string | null;
    timeZone: string;
  } | null>(null);

  if (session && session.identity !== identity) {
    // Drop the previous identity's session zone before paint.
    setSession(null);
  }

  useEffect(() => {
    if (!settingsSettled || session) return;
    setSession({ identity, timeZone: formatter.timeZone });
  }, [settingsSettled, session, identity, formatter.timeZone]);

  return session && session.identity === identity ? session.timeZone : null;
}
