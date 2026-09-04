// Identity lifecycle Email renderers (#297).
//
// Pure functions over structured payloads, following the
// `renderGradeNotificationEmail` content boundary (P5-N1-I2): server-generated
// zh-CN copy, a single trusted absolute link, and NO secret other than the
// token link itself — the raw token exists only in the delivered body, never
// in audit payloads or application logs. There is deliberately NO template
// engine / backend i18n runtime (ADR-011 §24).

import type { RenderedEmailContent } from "../email/renderedEmail.js";
import { escapeEmailHtml } from "../email/renderedEmail.js";
import type { StaffInvitationRole } from "@exam/contracts";

/** Structured input to the staff-invitation renderer. */
export interface StaffInvitationEmailPayload {
  /**
   * Invited staff role. INVARIANT: this is the closed `StaffInvitationRole`
   * contract enforced by `CreateStaffInvitationRequestSchema` at the wire
   * boundary — the renderer has no raw-string fallback path (C6 F-14).
   */
  role: StaffInvitationRole;
  /** Absolute acceptance URL from `buildInviteAcceptLink`. */
  acceptUrl: string;
  /** Invitation validity in whole days (display only). */
  expiresInDays: number;
}

/** Structured input to the password-reset renderer. */
export interface PasswordResetEmailPayload {
  /** Absolute reset URL from `buildPasswordResetLink`. */
  resetUrl: string;
  /** Token validity in whole minutes (display only). */
  expiresInMinutes: number;
}

/**
 * zh-CN display labels for invitable staff roles. Mirrors the web locale
 * labels (`admin.users.roleLabels`) so email copy and UI copy agree; kept
 * local because server Email copy cannot import the web app's i18n.
 * Typed as the closed role contract so a missing label is a compile error
 * and the raw role key can never reach the rendered Email (C6 F-14).
 */
export const STAFF_ROLE_LABELS_ZH: Record<StaffInvitationRole, string> = {
  // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
  Admin: "考试管理员",
  // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
  Teacher: "教师",
  // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
  Proctor: "监考员",
  // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
  Grader: "阅卷员",
  // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
  Maintainer: "系统运维",
};

/** Renders the staff-invitation Email content. */
export function renderStaffInvitationEmail(
  payload: StaffInvitationEmailPayload,
): RenderedEmailContent {
  const roleLabel = STAFF_ROLE_LABELS_ZH[payload.role];
  const link = payload.acceptUrl;
  // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
  const subject = "账号邀请";
  const bodyText =
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `您收到加入考试平台的邀请，角色：${roleLabel}。\n` +
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `请点击以下链接设置账号并激活（${payload.expiresInDays} 天内有效，仅可使用一次）：\n` +
    `${link}\n\n` +
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `若您未期待此邮件，请忽略本邮件。`;
  const bodyHtml =
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `<p>您收到加入考试平台的邀请，角色：<strong>${escapeEmailHtml(roleLabel)}</strong>。</p>` +
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `<p><a href="${escapeEmailHtml(link)}">点击激活账号</a>（${payload.expiresInDays} 天内有效，仅可使用一次）</p>` +
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `<p style="color:#888;font-size:12px;">若您未期待此邮件，请忽略本邮件。</p>`;
  return { subject, bodyText, bodyHtml };
}

/** Renders the password-reset Email content. */
export function renderPasswordResetEmail(
  payload: PasswordResetEmailPayload,
): RenderedEmailContent {
  const link = payload.resetUrl;
  // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
  const subject = "重置密码";
  const bodyText =
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `您申请了重置登录密码。\n` +
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `请点击以下链接设置新密码（${payload.expiresInMinutes} 分钟内有效，仅可使用一次）：\n` +
    `${link}\n\n` +
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `若您没有申请重置密码，请忽略本邮件，您的账号不会受影响。`;
  const bodyHtml =
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `<p>您申请了重置登录密码。</p>` +
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `<p><a href="${escapeEmailHtml(link)}">点击设置新密码</a>（${payload.expiresInMinutes} 分钟内有效，仅可使用一次）</p>` +
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `<p style="color:#888;font-size:12px;">若您没有申请重置密码，请忽略本邮件，您的账号不会受影响。</p>`;
  return { subject, bodyText, bodyHtml };
}
