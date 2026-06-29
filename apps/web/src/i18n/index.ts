import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./locales/zh-CN.js";

/**
 * i18n foundation (ADR: i18n foundation J1-J3).
 *
 * Single-locale (zh-CN) Phase 2 baseline. Resources are inlined (no HTTP
 * backend, no language detector) so the runtime stays LAN/offline-capable
 * and there is no async loading/Suspense boundary needed for the default
 * locale. The catalog is typed via `apps/web/src/i18n/i18next.d.ts` so
 * `t("status.exam.draft")` is compile-time checked.
 *
 * To add a locale later: add a catalog under `locales/`, register it in
 * `resources` below + `SUPPORTED_LOCALES`, and wire a language switcher.
 */
export const SUPPORTED_LOCALES = ["zh-CN"] as const;
export const DEFAULT_LOCALE = "zh-CN" as const;

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
  },
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  interpolation: {
    // React already escapes; no need for i18next to escape values.
    escapeValue: false,
  },
  returnNull: false,
});

export default i18n;
