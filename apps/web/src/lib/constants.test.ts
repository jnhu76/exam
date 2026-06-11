import { describe, expect, it } from "vitest";
import {
  STATUS_LABELS,
  STATUS_VARIANT,
  TYPE_LABELS,
  TYPE_VARIANT,
  CONNECTION_STATUS_LABELS,
  isExamStatus,
  isQuestionType,
  getStatusLabel,
  getStatusVariant,
  getTypeLabel,
  getTypeVariant,
} from "./constants";

describe("STATUS_LABELS", () => {
  it("contains all expected exam statuses", () => {
    expect(STATUS_LABELS.draft).toBe("草稿");
    expect(STATUS_LABELS.published).toBe("已发布");
    expect(STATUS_LABELS.open).toBe("进行中");
    expect(STATUS_LABELS.closed).toBe("已结束");
    expect(STATUS_LABELS.archived).toBe("已归档");
  });
});

describe("STATUS_VARIANT", () => {
  it("maps each status to a valid badge variant", () => {
    const validVariants = ["default", "secondary", "outline", "destructive"];
    for (const variant of Object.values(STATUS_VARIANT)) {
      expect(validVariants).toContain(variant);
    }
  });
});

describe("TYPE_LABELS", () => {
  it("contains all expected question types", () => {
    expect(TYPE_LABELS.single_choice).toBe("单选");
    expect(TYPE_LABELS.multiple_choice).toBe("多选");
    expect(TYPE_LABELS.fill_blank).toBe("填空");
    expect(TYPE_LABELS.true_false).toBe("判断");
  });
});

describe("TYPE_VARIANT", () => {
  it("maps each type to a valid badge variant", () => {
    const validVariants = ["default", "secondary", "outline"];
    for (const variant of Object.values(TYPE_VARIANT)) {
      expect(validVariants).toContain(variant);
    }
  });
});

describe("CONNECTION_STATUS_LABELS", () => {
  it("contains all connection statuses", () => {
    expect(CONNECTION_STATUS_LABELS.connected).toBe("连接正常");
    expect(CONNECTION_STATUS_LABELS.degraded).toBe("连接不稳定");
    expect(CONNECTION_STATUS_LABELS.offline).toBe("连接已断开");
  });
});

describe("type guards and getters", () => {
  it("isExamStatus identifies valid and invalid statuses", () => {
    expect(isExamStatus("draft")).toBe(true);
    expect(isExamStatus("open")).toBe(true);
    expect(isExamStatus("nonexistent")).toBe(false);
  });

  it("isQuestionType identifies valid and invalid types", () => {
    expect(isQuestionType("single_choice")).toBe(true);
    expect(isQuestionType("essay")).toBe(false);
  });

  it("getStatusLabel returns label or undefined", () => {
    expect(getStatusLabel("draft")).toBe("草稿");
    expect(getStatusLabel("nonexistent")).toBeUndefined();
  });

  it("getStatusVariant returns variant or undefined", () => {
    expect(getStatusVariant("draft")).toBe("outline");
    expect(getStatusVariant("nonexistent")).toBeUndefined();
  });

  it("getTypeLabel returns label or undefined", () => {
    expect(getTypeLabel("single_choice")).toBe("单选");
    expect(getTypeLabel("essay")).toBeUndefined();
  });

  it("getTypeVariant returns variant or undefined", () => {
    expect(getTypeVariant("single_choice")).toBe("default");
    expect(getTypeVariant("essay")).toBeUndefined();
  });
});
