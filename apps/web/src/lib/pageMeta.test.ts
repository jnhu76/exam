import { describe, expect, it } from "vitest";
import {
  getFallbackPageTitle,
  getFallbackProductName,
  getDocumentTitle,
  getPageTitle,
} from "@/lib/pageMeta";
import { routes } from "@/lib/routes";

describe("page metadata", () => {
  it("returns static admin route titles", () => {
    expect(getPageTitle("/admin/dashboard")).toBe("仪表盘");
    expect(getPageTitle("/admin/settings")).toBe("平台设置");
    expect(getPageTitle("/admin/recovery")).toBe("恢复中心");
  });

  it("returns the grading queue title for its registered route", () => {
    expect(getPageTitle(routes.admin.gradingQueue)).toBe("待评分");
  });

  it("resolves the grading queue title through trailing-slash normalization", () => {
    expect(getPageTitle(`${routes.admin.gradingQueue}/`)).toBe("待评分");
  });

  it("builds the grading queue document title from the same authority", () => {
    expect(getDocumentTitle(routes.admin.gradingQueue, "测评平台")).toBe(
      "待评分 - 测评平台",
    );
  });

  it("returns candidate-facing route titles", () => {
    expect(getPageTitle("/exam/list")).toBe("我的考试");
    expect(getPageTitle("/exam/exam-1/start")).toBe("考试准备");
    expect(getPageTitle("/exam/attempt-1/take")).toBe("正在答题");
    expect(getPageTitle("/exam/attempt-1/result")).toBe("考试结果");
  });

  it("returns dynamic admin route titles", () => {
    expect(getPageTitle("/admin/exams/exam-1")).toBe("考试详情");
    expect(getPageTitle("/admin/exams/exam-1/scores")).toBe("成绩列表");
    expect(getPageTitle("/admin/questions/question-1/edit")).toBe("编辑题目");
    expect(getPageTitle("/admin/attempts/attempt-1")).toBe("答题详情");
    expect(getPageTitle("/admin/recovery/incidents/incident-1")).toBe(
      "事件详情",
    );
    expect(getPageTitle("/admin/recovery/attempts/attempt-1")).toBe(
      "答题操作详情",
    );
    expect(getPageTitle("/admin/recovery/exams/exam-1")).toBe("考试恢复详情");
  });

  it("returns a stable fallback page title", () => {
    expect(getPageTitle("/admin/unknown")).toBe(getFallbackPageTitle());
  });

  it("builds document titles with product fallback", () => {
    expect(getDocumentTitle("/admin/dashboard", "测评平台")).toBe(
      "仪表盘 - 测评平台",
    );
    expect(getDocumentTitle("/admin/dashboard", "  ")).toBe(
      `仪表盘 - ${getFallbackProductName()}`,
    );
  });
});
