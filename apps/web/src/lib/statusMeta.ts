import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Ban,
  CheckCircle2,
  Circle,
  CircleAlert,
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
  Timer,
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

/** Display metadata for a single status: label, tone, and icon. */
export interface StatusMeta {
  label: string;
  tone: StatusTone;
  icon: LucideIcon;
}

/** Lookup table mapping status keys to their display label, tone, and icon. */
export const statusMeta = {
  draft: { label: "草稿", tone: "muted", icon: FilePenLine },
  published: { label: "已发布", tone: "primary", icon: Send },
  open: { label: "开放中", tone: "success", icon: LockOpen },
  closed: { label: "已关闭", tone: "secondary", icon: Lock },
  archived: { label: "已归档", tone: "muted", icon: Archive },
  assigned: { label: "已分配", tone: "primary", icon: ShieldCheck },
  started: { label: "已开始", tone: "success", icon: Play },
  completed: { label: "已完成", tone: "secondary", icon: CheckCircle2 },
  blocked: { label: "已阻止", tone: "destructive", icon: Ban },
  not_started: { label: "未开始", tone: "muted", icon: Circle },
  queued: { label: "排队中", tone: "warning", icon: Clock },
  in_progress: { label: "答题中", tone: "primary", icon: Radio },
  disrupted: { label: "断线", tone: "warning", icon: WifiOff },
  submitted: { label: "已交卷", tone: "secondary", icon: Send },
  grading: { label: "批改中", tone: "primary", icon: LoaderCircle },
  graded: { label: "已评分", tone: "success", icon: Trophy },
  voided: { label: "已作废", tone: "destructive", icon: Ban },
  saving: { label: "保存中", tone: "warning", icon: LoaderCircle },
  saved: { label: "已保存", tone: "success", icon: CheckCircle2 },
  failed: { label: "保存失败", tone: "destructive", icon: CircleAlert },
  canceled: { label: "已取消", tone: "muted", icon: XCircle },
  expired: { label: "已过期", tone: "destructive", icon: Clock },
  stale: { label: "过期数据", tone: "warning", icon: CircleAlert },
  connected: { label: "连接正常", tone: "success", icon: Wifi },
  degraded: { label: "连接不稳定", tone: "warning", icon: CircleAlert },
  offline: { label: "连接已断开", tone: "destructive", icon: WifiOff },
  ok: { label: "正常", tone: "success", icon: CheckCircle2 },
  critical: { label: "严重", tone: "destructive", icon: CircleAlert },
  unknown: { label: "未知", tone: "muted", icon: HelpCircle },
  passed: { label: "及格", tone: "success", icon: Trophy },
  not_passed: { label: "不及格", tone: "destructive", icon: XCircle },
  auto_graded: { label: "自动评分", tone: "secondary", icon: CheckCircle2 },
  pending_manual: {
    label: "待手动评分",
    tone: "warning",
    icon: Clock,
  },
  fully_graded: { label: "已完成评分", tone: "success", icon: Trophy },
  misconduct_warning: {
    label: "违规-警告",
    tone: "warning",
    icon: Flag,
  },
  misconduct_serious: {
    label: "违规-严重",
    tone: "destructive",
    icon: Flag,
  },
  available: { label: "可参加", tone: "success", icon: LockOpen },
  resumable: { label: "可恢复", tone: "primary", icon: Play },
  submitted_pending_grade: {
    label: "待评分",
    tone: "warning",
    icon: Clock,
  },
  max_attempts_exhausted: {
    label: "次数已用完",
    tone: "destructive",
    icon: Ban,
  },
  not_started_yet: { label: "未开放", tone: "muted", icon: Timer },
  unavailable: { label: "不可用", tone: "destructive", icon: Ban },
  import_success: { label: "成功", tone: "success", icon: CheckCircle2 },
  import_partial: { label: "部分成功", tone: "warning", icon: CircleAlert },
} as const satisfies Record<string, StatusMeta>;

/** Union of all recognized status keys. */
export type StatusKey = keyof typeof statusMeta;

/** Returns true if the given string is a known status key. */
export function isStatusKey(status: string): status is StatusKey {
  return status in statusMeta;
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

/** Soft-filled tag background + text classes for each status tone (single source of truth). */
export const toneTagClass: Record<StatusTone, string> = {
  primary: "bg-primary-soft text-primary",
  secondary: "bg-secondary text-secondary-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  destructive: "bg-destructive-soft text-destructive",
  info: "bg-info-soft text-info",
  muted: "bg-neutral-soft text-muted-foreground",
};

/** Returns the Tailwind text-color class for a given status tone. */
export function getToneTextColor(tone: StatusTone): string {
  return toneTextColorMap[tone];
}

/** Returns the display metadata for a status key, falling back to "unknown". */
export function getStatusMeta(status: string): StatusMeta {
  return isStatusKey(status) ? statusMeta[status] : statusMeta.unknown;
}
