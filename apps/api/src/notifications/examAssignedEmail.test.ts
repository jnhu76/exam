import { describe, it, expect } from "vitest";
import { renderExamAssignedEmail } from "./examAssignedEmail.js";

// #299 Slice — exam_assigned renderer contract.
//
// Mirrors the gradeNotificationEmail renderer tests: correct subject, the
// important body copy, the trusted absolute link present verbatim, HTML
// interpolation escaped. No big snapshots — small semantic assertions.

const ORIGIN = "https://exam.example.local";

describe("renderExamAssignedEmail", () => {
  it("uses the zh-CN subject 考试已安排", () => {
    const rendered = renderExamAssignedEmail({
      examTitle: "期中考试",
      listUrl: `${ORIGIN}/exam/list`,
    });
    expect(rendered.subject).toBe("考试已安排");
  });

  it("interpolates the exam title and the trusted list URL in both bodies", () => {
    const rendered = renderExamAssignedEmail({
      examTitle: "期中考试",
      listUrl: `${ORIGIN}/exam/list`,
    });
    expect(rendered.bodyText).toContain("期中考试");
    expect(rendered.bodyText).toContain(`${ORIGIN}/exam/list`);
    expect(rendered.bodyText).toContain("考试列表");
    expect(rendered.bodyHtml).toContain(`${ORIGIN}/exam/list`);
    expect(rendered.bodyHtml).toContain("期中考试");
  });

  it("HTML-escapes the exam title in bodyHtml but keeps bodyText verbatim", () => {
    const rendered = renderExamAssignedEmail({
      examTitle: 'Math <script>alert("x")</script> & "final"',
      listUrl: `${ORIGIN}/exam/list`,
    });
    // Raw markup must not survive into the HTML body.
    expect(rendered.bodyHtml).not.toContain("<script>");
    expect(rendered.bodyHtml).not.toContain('& "final"');
    expect(rendered.bodyHtml).toContain(
      "Math &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;final&quot;",
    );
    // Plain-text body carries the raw title (no HTML context there).
    expect(rendered.bodyText).toContain('Math <script>alert("x")</script>');
  });

  it("HTML-escapes a malicious link value if one is ever passed", () => {
    // The renderer trusts its caller to pass a builder-produced URL; as
    // defense in depth the href attribute value is still escaped, so the
    // attribute cannot be closed early (no attribute breakout).
    const rendered = renderExamAssignedEmail({
      examTitle: "T",
      listUrl: `${ORIGIN}/exam/list" onmouseover="alert(1)`,
    });
    expect(rendered.bodyHtml).not.toContain('" onmouseover="');
    expect(rendered.bodyHtml).toContain("/exam/list&quot;");
  });
});
