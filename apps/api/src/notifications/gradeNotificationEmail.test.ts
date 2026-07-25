import { describe, it, expect } from "vitest";
import {
  renderGradeNotificationEmail,
  type GradeNotificationPayload,
} from "./gradeNotificationEmail.js";

// P5-N1-I2 Slice 2 — grade_notification Email renderer (P5-N1-R0 §15 frozen).
//
// The renderer takes a STRUCTURED payload ({ examTitle, actionPath }) and
// produces { subject, bodyText, bodyHtml } — it does NOT query repositories.
// Content boundary (§15):
//   - subject: "考试结果已发布" (server-generated zh-CN)
//   - body: examTitle (HTML-escaped) + a trusted link back to EXAM
//   - NO score, NO pass/fail, NO standard answers, NO rubric, NO grader
// The leakage boundary mirrors P3-R0 §6: standardAnswer is stripped from the
// candidate-visible DTO and must not re-enter via Email.

describe("renderGradeNotificationEmail", () => {
  const payload: GradeNotificationPayload = {
    examTitle: "2026 年度认证考试",
    actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
  };

  it("returns subject, bodyText, and bodyHtml", () => {
    const out = renderGradeNotificationEmail(payload);
    expect(out).toHaveProperty("subject");
    expect(out).toHaveProperty("bodyText");
    expect(out).toHaveProperty("bodyHtml");
  });

  it("subject is a server-generated zh-CN string", () => {
    const out = renderGradeNotificationEmail(payload);
    expect(out.subject).toBe("考试结果已发布");
  });

  it("bodyText mentions the exam title", () => {
    const out = renderGradeNotificationEmail(payload);
    expect(out.bodyText).toContain("2026 年度认证考试");
  });

  it("bodyHtml mentions the exam title and is escaped", () => {
    const out = renderGradeNotificationEmail({
      examTitle: "<script>alert(1)</script>",
      actionPath: "/exam/x/result",
    });
    // The raw <script> tag MUST be escaped, not emitted verbatim.
    expect(out.bodyHtml).not.toContain("<script>alert(1)</script>");
    expect(out.bodyHtml).toContain("&lt;script&gt;");
  });

  it("bodyText contains the absolute link (caller combines origin)", () => {
    // The renderer emits the link as provided; the caller (NotificationService)
    // is responsible for prepending PUBLIC_WEB_ORIGIN via buildAbsoluteResultLink.
    // For the bodyText we accept either the site-relative path or an absolute
    // URL; the contract is "the link is present and identifiable".
    const out = renderGradeNotificationEmail(payload);
    expect(out.bodyText).toMatch(/\/exam\/[0-9a-f-]+\/result/);
  });

  it("bodyHtml contains an <a> link with the path", () => {
    const out = renderGradeNotificationEmail(payload);
    expect(out.bodyHtml).toMatch(/href="[^"]*\/exam\/[0-9a-f-]+\/result"/);
  });

  describe("content boundary (P5-N1-R0 §15 / P3-R0 §6 leakage class)", () => {
    // The renderer must NEVER emit score / pass status / standard answers /
    // rubric / grader identity. These are inside EXAM (Inbox + result page),
    // never in the Email.
    const forbidden = [
      "score",
      "分数",
      "得分",
      "passed",
      "通过",
      "未通过",
      "standard answer",
      "标准答案",
      "rubric",
      "评分细则",
      "grader",
      "评卷人",
    ];

    for (const word of forbidden) {
      it(`does NOT leak "${word}" into subject/bodyText/bodyHtml`, () => {
        const out = renderGradeNotificationEmail({
          examTitle: "Some Exam",
          actionPath: "/exam/x/result",
        });
        const lower = (s: string) => s.toLowerCase();
        expect(lower(out.subject)).not.toContain(lower(word));
        expect(lower(out.bodyText)).not.toContain(lower(word));
        expect(lower(out.bodyHtml)).not.toContain(lower(word));
      });
    }
  });

  it("escapes an ampersand in the exam title", () => {
    const out = renderGradeNotificationEmail({
      examTitle: "Tom & Jerry",
      actionPath: "/exam/x/result",
    });
    expect(out.bodyHtml).toContain("Tom &amp; Jerry");
  });
});
