// exam_assigned Email renderer (#299, first slice of #402).
//
// Pure function over a structured payload, following the
// `renderGradeNotificationEmail` content boundary (P5-N1-I2): server-generated
// zh-CN copy, a single trusted absolute link, and no leakage class beyond the
// exam title — no exam state, no questions, no rubric. The Inbox notification
// is the awareness channel; this Email is the offline recall.

import type { RenderedEmailContent } from "../email/renderedEmail.js";
import { escapeEmailHtml } from "../email/renderedEmail.js";

/** Structured input to the exam_assigned renderer. */
export interface ExamAssignedEmailPayload {
  /** Server-trusted exam title (HTML-escaped at render time). */
  examTitle: string;
  /**
   * Absolute exam-list URL = PUBLIC_WEB_ORIGIN + validated action path
   * (`/exam/list`). The caller is responsible for combining via
   * `buildAbsoluteNotificationLink` so the renderer never sees a
   * site-relative path or an unvalidated origin.
   */
  listUrl: string;
}

/**
 * Renders the exam_assigned Email content from a structured payload.
 *
 * The Inbox row remains the awareness + navigation authority; the Email copy
 * mirrors it (title + a pointer to the exam list) and deliberately does NOT
 * duplicate exam state.
 */
export function renderExamAssignedEmail(
  payload: ExamAssignedEmailPayload,
): RenderedEmailContent {
  const examTitle = payload.examTitle;
  const link = payload.listUrl;
  const subject = "考试已安排";
  const bodyText =
    `您已被安排参加考试「${examTitle}」，请进入考试列表查看详情。\n` +
    `请登录考试平台查看：${link}\n\n` +
    `（本邮件由系统自动发送，请勿直接回复。）`;
  const bodyHtml =
    `<p>您已被安排参加考试「${escapeEmailHtml(examTitle)}」，请进入考试列表查看详情。</p>` +
    `<p><a href="${escapeEmailHtml(link)}">查看考试列表</a></p>` +
    `<p style="color:#888;font-size:12px;">本邮件由系统自动发送，请勿直接回复。</p>`;
  return { subject, bodyText, bodyHtml };
}
