import { describe, expect, it } from "vitest";
import { getStatusMeta, isStatusKey, statusMeta } from "./statusMeta";

describe("statusMeta", () => {
  it("defines centralized labels for exam and connection statuses", () => {
    expect(statusMeta.draft.label).toBe("草稿");
    expect(statusMeta.open.label).toBe("开放中");
    expect(statusMeta.connected.label).toBe("连接正常");
  });

  it("matches the documented status grammar labels and tones", () => {
    expect(statusMeta.closed).toMatchObject({
      label: "已关闭",
      tone: "secondary",
    });
    expect(statusMeta.started).toMatchObject({
      label: "已开始",
      tone: "success",
    });
    expect(statusMeta.blocked).toMatchObject({
      label: "已阻止",
      tone: "destructive",
    });
    expect(statusMeta.in_progress).toMatchObject({
      label: "答题中",
      tone: "primary",
    });
    expect(statusMeta.submitted).toMatchObject({
      label: "已交卷",
      tone: "secondary",
    });
    expect(statusMeta.saving).toMatchObject({
      label: "保存中",
      tone: "warning",
    });
    expect(statusMeta.failed).toMatchObject({
      label: "保存失败",
      tone: "destructive",
    });
    expect(statusMeta.expired).toMatchObject({
      label: "已过期",
      tone: "destructive",
    });
  });

  it("detects known status keys", () => {
    expect(isStatusKey("published")).toBe(true);
    expect(isStatusKey("not_a_status")).toBe(false);
  });

  it("falls back to unknown metadata for unsupported statuses", () => {
    expect(getStatusMeta("not_a_status")).toEqual(statusMeta.unknown);
  });
});
