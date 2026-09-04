// P5-N1-I2 Slice 2 — grade_notification Email renderer.
//
// Authority: P5-N1-R0 §15 (frozen content boundary).
//
// The renderer is a PURE function over a structured payload. It does NOT
// query repositories, does NOT call SMTP, and does NOT depend on Fastify.
// The caller (NotificationService) is responsible for:
//   - building the payload from trusted sources (exam title from Exam row;
//     actionPath from buildResultPublishedActionPath)
//   - combining the actionPath with PUBLIC_WEB_ORIGIN via
//     buildAbsoluteResultLink BEFORE passing the absolute URL here
//
// Content boundary (mirrors P3-R0 §6 leakage class):
//   subject: "考试结果已发布" (server-generated zh-CN)
//   body:    examTitle (HTML-escaped) + a trusted link back to EXAM
//   MUST NOT include: score, pass/fail, standard answers, rubric, grader
//   identity. Those live inside EXAM (Inbox + result page), never the Email.

import type { RenderedEmailContent } from "../email/renderedEmail.js";
import { escapeEmailHtml } from "../email/renderedEmail.js";

/** Structured input to the grade_notification renderer. */
export interface GradeNotificationPayload {
  /** Server-trusted exam title (HTML-escaped at render time). */
  examTitle: string;
  /**
   * Absolute result URL = PUBLIC_WEB_ORIGIN + validated action path. The
   * caller is responsible for combining via `buildAbsoluteResultLink` so the
   * renderer never sees a site-relative path or an unvalidated origin.
   */
  actionPath: string;
}

/**
 * Renders the grade_notification Email content from a structured payload.
 *
 * The output is server-generated zh-CN copy with the exam title interpolated
 * (escaped) and a single trusted link. No score, no pass/fail, no standard
 * answers, no rubric, no grader identity (P5-N1-R0 §15 / P3-R0 §6).
 */
export function renderGradeNotificationEmail(
  payload: GradeNotificationPayload,
): RenderedEmailContent {
  const examTitle = payload.examTitle;
  const link = payload.actionPath;
  // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
  const subject = "考试结果已发布";
  const bodyText =
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `您参加的考试「${examTitle}」的结果已发布。\n` +
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `请登录考试平台查看：${link}\n\n` +
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `（本邮件由系统自动发送，请勿直接回复。）`;
  const bodyHtml =
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `<p>您参加的考试「${escapeEmailHtml(examTitle)}」的结果已发布。</p>` +
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `<p><a href="${escapeEmailHtml(link)}">点击查看考试结果</a></p>` +
    // i18n-copy-allow: server-rendered — Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n
    `<p style="color:#888;font-size:12px;">本邮件由系统自动发送，请勿直接回复。</p>`;
  return { subject, bodyText, bodyHtml };
}
