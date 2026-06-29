import { describe, expect, it } from "vitest";
import {
  getFallbackPageTitle,
  getFallbackProductName,
  getDocumentTitle,
  getPageTitle,
} from "@/lib/pageMeta";

describe("page metadata", () => {
  it("returns static admin route titles", () => {
    expect(getPageTitle("/admin/dashboard")).toBe("仪表盘");
    expect(getPageTitle("/admin/settings")).toBe("平台设置");
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
