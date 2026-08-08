import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Ban,
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleCheck,
  Clock,
  FilePenLine,
  Flag,
  HelpCircle,
  LoaderCircle,
  Lock,
  LockOpen,
  Play,
  Radio,
  Send,
  ShieldCheck,
  Trophy,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";

/** Color-tone classification for status badges. */
export type StatusTone =
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "muted";

/** Display metadata for a single status: i18n label key, tone, and icon.
 * The Chinese label text is resolved at render time via `t(meta.labelKey)`
 * (see StatusBadge); `statusMeta` itself stores NO hardcoded copy. */
export interface StatusMeta {
  /** i18n key (under the `translation` namespace) for this status's label. */
  labelKey: string;
  tone: StatusTone;
  icon: LucideIcon;
  /**
   * Default icon visibility for this status in dense/table contexts.
   * - "show": the status carries urgency/destructive/live meaning that the
   *   icon helps communicate; StatusBadge shows the icon by default.
   * - omitted: ordinary/dense status; StatusBadge defaults to text-only.
   * Explicit `showIcon` prop on StatusBadge overrides this either way.
   */
  iconPolicy?: "show";
}

/** Lookup table mapping status keys to their display label key, tone, and icon. */
export const statusMeta = {
  draft: { labelKey: "status.exam.draft", tone: "muted", icon: FilePenLine },
  published: { labelKey: "status.exam.published", tone: "primary", icon: Send },
  open: { labelKey: "status.exam.open", tone: "success", icon: LockOpen },
  closed: { labelKey: "status.exam.closed", tone: "secondary", icon: Lock },
  archived: { labelKey: "status.exam.archived", tone: "muted", icon: Archive },
  assigned: {
    labelKey: "status.enrollment.assigned",
    tone: "primary",
    icon: ShieldCheck,
  },
  started: {
    labelKey: "status.enrollment.started",
    tone: "success",
    icon: Play,
  },
  completed: {
    labelKey: "status.enrollment.completed",
    tone: "secondary",
    icon: CheckCircle2,
  },
  blocked: {
    labelKey: "status.enrollment.blocked",
    tone: "destructive",
    icon: Ban,
    iconPolicy: "show",
  },
  not_started: {
    labelKey: "status.enrollment.not_started",
    tone: "muted",
    icon: Circle,
  },
  queued: {
    labelKey: "status.attempt.queued",
    tone: "warning",
    icon: Clock,
  },
  in_progress: {
    labelKey: "status.attempt.in_progress",
    tone: "primary",
    icon: Radio,
  },
  disrupted: {
    labelKey: "status.attempt.disrupted",
    tone: "warning",
    icon: WifiOff,
    iconPolicy: "show",
  },
  submitted: {
    labelKey: "status.attempt.submitted",
    tone: "secondary",
    icon: CircleCheck,
  },
  grading: {
    labelKey: "status.attempt.grading",
    tone: "primary",
    icon: LoaderCircle,
  },
  graded: { labelKey: "status.attempt.graded", tone: "success", icon: Trophy },
  voided: {
    labelKey: "status.attempt.voided",
    tone: "destructive",
    icon: Ban,
    iconPolicy: "show",
  },
  // Incident statuses (J5-I1B Recovery Center — queue + aggregate wire:
  // open | investigating | resolved | dismissed). Domain keys are prefixed
  // because `open` collides with the exam lifecycle status.
  incidentOpen: {
    labelKey: "status.incident.open",
    tone: "warning",
    icon: CircleAlert,
    iconPolicy: "show",
  },
  incidentInvestigating: {
    labelKey: "status.incident.investigating",
    tone: "primary",
    icon: LoaderCircle,
  },
  incidentResolved: {
    labelKey: "status.incident.resolved",
    tone: "success",
    icon: CheckCircle2,
  },
  incidentDismissed: {
    labelKey: "status.incident.dismissed",
    tone: "muted",
    icon: XCircle,
  },
  saving: {
    labelKey: "status.save.saving",
    tone: "warning",
    icon: LoaderCircle,
    iconPolicy: "show",
  },
  saved: { labelKey: "status.save.saved", tone: "success", icon: CheckCircle2 },
  failed: {
    labelKey: "status.save.failed",
    tone: "destructive",
    icon: CircleAlert,
  },
  canceled: {
    labelKey: "status.lifecycle.canceled",
    tone: "muted",
    icon: XCircle,
  },
  expired: {
    labelKey: "status.lifecycle.expired",
    tone: "destructive",
    icon: Clock,
  },
  stale: {
    labelKey: "status.lifecycle.stale",
    tone: "warning",
    icon: CircleAlert,
  },
  connected: {
    labelKey: "status.connection.connected",
    tone: "success",
    icon: Wifi,
  },
  degraded: {
    labelKey: "status.connection.degraded",
    tone: "warning",
    icon: CircleAlert,
  },
  offline: {
    labelKey: "status.connection.offline",
    tone: "destructive",
    icon: WifiOff,
    iconPolicy: "show",
  },
  ok: { labelKey: "status.health.ok", tone: "success", icon: CheckCircle2 },
  critical: {
    labelKey: "status.health.critical",
    tone: "destructive",
    icon: CircleAlert,
    iconPolicy: "show",
  },
  // P3-M5B: diagnostics infrastructure status vocabulary. Used by the
  // SystemDiagnosticsPage email/worker surfaces via StatusBadge. Map the
  // API's lower-case enum values to these keys with infraStatusKey() below.
  infraAvailable: {
    labelKey: "status.infra.available",
    tone: "success",
    icon: CheckCircle2,
  },
  infraConnecting: {
    labelKey: "status.infra.connecting",
    tone: "info",
    icon: LoaderCircle,
    iconPolicy: "show",
  },
  infraDegraded: {
    labelKey: "status.infra.degraded",
    tone: "warning",
    icon: CircleAlert,
  },
  infraUnavailable: {
    labelKey: "status.infra.unavailable",
    tone: "destructive",
    icon: XCircle,
    iconPolicy: "show",
  },
  infraDisabled: {
    labelKey: "status.infra.disabled",
    tone: "muted",
    icon: Ban,
  },
  infraUnknown: {
    labelKey: "status.infra.unknown",
    tone: "muted",
    icon: HelpCircle,
  },
  active: {
    labelKey: "status.account.active",
    tone: "success",
    icon: CheckCircle2,
  },
  inactive: {
    labelKey: "status.account.inactive",
    tone: "muted",
    icon: Ban,
  },
  unknown: {
    labelKey: "status.fallback.unknown",
    tone: "muted",
    icon: HelpCircle,
  },
  passed: { labelKey: "status.result.passed", tone: "success", icon: Trophy },
  not_passed: {
    labelKey: "status.result.not_passed",
    tone: "destructive",
    icon: XCircle,
  },
  auto_graded: {
    labelKey: "status.grading.auto_graded",
    tone: "secondary",
    icon: CheckCircle2,
  },
  pending_manual: {
    labelKey: "status.grading.pending_manual",
    tone: "warning",
    icon: Clock,
  },
  fully_graded: {
    labelKey: "status.grading.fully_graded",
    tone: "success",
    icon: Trophy,
  },
  misconduct_warning: {
    labelKey: "status.misconduct.misconduct_warning",
    tone: "warning",
    icon: Flag,
    iconPolicy: "show",
  },
  misconduct_serious: {
    labelKey: "status.misconduct.misconduct_serious",
    tone: "destructive",
    icon: Flag,
    iconPolicy: "show",
  },
} as const satisfies Record<string, StatusMeta>;

/** Union of all recognized status keys. */
export type StatusKey = keyof typeof statusMeta;

/** Returns true if the given string is a known status key. */
export function isStatusKey(status: string): status is StatusKey {
  return status in statusMeta;
}

/**
 * Maps a diagnostics infrastructure status value (the API's lower-case enum:
 * available/degraded/unavailable/disabled/unknown) to the matching statusMeta
 * key. Used by the SystemDiagnosticsPage email/worker surfaces so they can
 * render via `<StatusBadge status={infraStatusKey(emailStatus.status)} />`.
 * Unknown values fall back to `infraUnknown` (fail-safe, never throws).
 */
export function infraStatusKey(
  status: string,
):
  | "infraAvailable"
  | "infraConnecting"
  | "infraDegraded"
  | "infraUnavailable"
  | "infraDisabled"
  | "infraUnknown" {
  switch (status) {
    case "available":
      return "infraAvailable";
    case "connecting":
      return "infraConnecting";
    case "degraded":
      return "infraDegraded";
    case "unavailable":
      return "infraUnavailable";
    case "disabled":
      return "infraDisabled";
    default:
      return "infraUnknown";
  }
}

/**
 * Maps a Redis runtime state (`disabled | connecting | ready | degraded |
 * closing`) to the matching infra statusMeta key for StatusBadge rendering.
 * The `mode` field (off/optional/required) is not mapped here — the
 * diagnostics page already renders mode-specific text when mode is off.
 */
export function redisInfraStatusKey(
  state: string,
):
  | "infraAvailable"
  | "infraConnecting"
  | "infraDegraded"
  | "infraDisabled"
  | "infraUnknown" {
  switch (state) {
    case "ready":
      return "infraAvailable";
    case "connecting":
      return "infraConnecting";
    case "degraded":
    case "closing":
      return "infraDegraded";
    case "disabled":
      return "infraDisabled";
    default:
      return "infraUnknown";
  }
}

const toneTextColorMap: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  info: "text-info",
  muted: "text-muted-foreground",
  primary: "text-primary",
  secondary: "text-secondary-foreground",
};

/** Returns the Tailwind text-color class for a given status tone. */
export function getToneTextColor(tone: StatusTone): string {
  return toneTextColorMap[tone];
}

/** Returns the display metadata for a status key, falling back to "unknown". */
export function getStatusMeta(status: string): StatusMeta {
  return isStatusKey(status) ? statusMeta[status] : statusMeta.unknown;
}

/**
 * Minimal translation function shape accepted by {@link getStatusLabel}.
 * Matches the `t` returned by react-i18next's `useTranslation()` and the
 * standalone i18n instance's `t`. Kept structural so this module does not
 * import react-i18next (avoids pulling React into non-component callers).
 */
export type StatusTranslateFn = (key: string) => string;

/**
 * Resolves the localized label for a status via the provided `t` function.
 * Use inside components: `getStatusLabel(status, t)` where `t` comes from
 * `useTranslation()`. Falls back to the raw key if `t` is not provided
 * (e.g. non-i18n contexts / unit tests that only assert tone/icon).
 */
export function getStatusLabel(status: string, t?: StatusTranslateFn): string {
  const meta = getStatusMeta(status);
  return t ? t(meta.labelKey) : meta.labelKey;
}
