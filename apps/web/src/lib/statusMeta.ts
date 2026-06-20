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
  graded: { label: "已出分", tone: "success", icon: Trophy },
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
  misconduct_warning: {
    label: "违规-警告",
    tone: "warning",
    icon: Flag,
  },
  misconduct_severe: {
    label: "违规-严重",
    tone: "destructive",
    icon: Flag,
  },
} as const satisfies Record<string, StatusMeta>;

/** Union of all recognized status keys. */
export type StatusKey = keyof typeof statusMeta;

/** Returns true if the given string is a known status key. */
export function isStatusKey(status: string): status is StatusKey {
  return status in statusMeta;
}

/** Returns the display metadata for a status key, falling back to "unknown". */
export function getStatusMeta(status: string): StatusMeta {
  return isStatusKey(status) ? statusMeta[status] : statusMeta.unknown;
}
