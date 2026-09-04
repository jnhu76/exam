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

/** Structured input to the staff-invitation renderer. */
export interface StaffInvitationEmailPayload {
  /** Invited staff role (server-trusted, from the invitation row). */
  role: string;
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
 */
export const STAFF_ROLE_LABELS_ZH: Record<string, string> = {
  Admin: "考试管理员",
  Teacher: "教师",
  Proctor: "监考员",
  Grader: "阅卷员",
  Maintainer: "系统运维",
};

/** Renders the staff-invitation Email content. */
export function renderStaffInvitationEmail(
  payload: StaffInvitationEmailPayload,
): RenderedEmailContent {
  const roleLabel = STAFF_ROLE_LABELS_ZH[payload.role] ?? payload.role;
  const link = payload.acceptUrl;
  const subject = "账号邀请";
  const bodyText =
    `您收到加入考试平台的邀请，角色：${roleLabel}。\n` +
    `请点击以下链接设置账号并激活（${payload.expiresInDays} 天内有效，仅可使用一次）：\n` +
    `${link}\n\n` +
    `若您未期待此邮件，请忽略本邮件。`;
  const bodyHtml =
    `<p>您收到加入考试平台的邀请，角色：<strong>${escapeEmailHtml(roleLabel)}</strong>。</p>` +
    `<p><a href="${escapeEmailHtml(link)}">点击激活账号</a>（${payload.expiresInDays} 天内有效，仅可使用一次）</p>` +
    `<p style="color:#888;font-size:12px;">若您未期待此邮件，请忽略本邮件。</p>`;
  return { subject, bodyText, bodyHtml };
}

/** Renders the password-reset Email content. */
export function renderPasswordResetEmail(
  payload: PasswordResetEmailPayload,
): RenderedEmailContent {
  const link = payload.resetUrl;
  const subject = "重置密码";
  const bodyText =
    `您申请了重置登录密码。\n` +
    `请点击以下链接设置新密码（${payload.expiresInMinutes} 分钟内有效，仅可使用一次）：\n` +
    `${link}\n\n` +
    `若您没有申请重置密码，请忽略本邮件，您的账号不会受影响。`;
  const bodyHtml =
    `<p>您申请了重置登录密码。</p>` +
    `<p><a href="${escapeEmailHtml(link)}">点击设置新密码</a>（${payload.expiresInMinutes} 分钟内有效，仅可使用一次）</p>` +
    `<p style="color:#888;font-size:12px;">若您没有申请重置密码，请忽略本邮件，您的账号不会受影响。</p>`;
  return { subject, bodyText, bodyHtml };
}
