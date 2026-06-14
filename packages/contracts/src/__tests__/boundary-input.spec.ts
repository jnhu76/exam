import { describe, it, expect } from "vitest";
import { z } from "zod";

describe("边界输入测试 - 字符串字段", () => {
  const stringSchema = z.object({
    username: z.string().min(3).max(50),
    name: z.string().min(1).max(100),
  });

  it("应该拒绝空字符串作为用户名", async () => {
    await expect(
      stringSchema.parseAsync({ username: "", name: "Test" }),
    ).rejects.toThrow();
  });

  it("应该拒绝过短的用户名", async () => {
    await expect(
      stringSchema.parseAsync({ username: "ab", name: "Test" }),
    ).rejects.toThrow();
  });

  it("应该接受最小长度的用户名", async () => {
    const result = await stringSchema.parseAsync({
      username: "abc",
      name: "Test",
    });
    expect(result.username).toBe("abc");
  });

  it("应该拒绝过长的用户名", async () => {
    const longUsername = "a".repeat(51);
    await expect(
      stringSchema.parseAsync({ username: longUsername, name: "Test" }),
    ).rejects.toThrow();
  });

  it("应该接受最大长度的用户名", async () => {
    const maxUsername = "a".repeat(50);
    const result = await stringSchema.parseAsync({
      username: maxUsername,
      name: "Test",
    });
    expect(result.username).toBe(maxUsername);
  });

  it("应该拒绝空字符串作为名称", async () => {
    await expect(
      stringSchema.parseAsync({ username: "testuser", name: "" }),
    ).rejects.toThrow();
  });

  it("应该接受单个字符作为名称", async () => {
    const result = await stringSchema.parseAsync({
      username: "testuser",
      name: "A",
    });
    expect(result.name).toBe("A");
  });

  it("应该拒绝过长的名称", async () => {
    const longName = "a".repeat(101);
    await expect(
      stringSchema.parseAsync({ username: "testuser", name: longName }),
    ).rejects.toThrow();
  });

  it("应该接受特殊字符", async () => {
    const result = await stringSchema.parseAsync({
      username: "test_user-123",
      name: "张三",
    });
    expect(result.username).toBe("test_user-123");
    expect(result.name).toBe("张三");
  });
});

describe("边界输入测试 - 数值字段", () => {
  const numberSchema = z.object({
    age: z.number().min(0).max(150),
    score: z.number().min(0).max(100),
    duration: z.number().min(1).max(9999),
  });

  it("应该拒绝负数作为年龄", async () => {
    await expect(
      numberSchema.parseAsync({ age: -1, score: 0, duration: 1 }),
    ).rejects.toThrow();
  });

  it("应该接受零作为年龄", async () => {
    const result = await numberSchema.parseAsync({
      age: 0,
      score: 0,
      duration: 1,
    });
    expect(result.age).toBe(0);
  });

  it("应该拒绝超出最大值的年龄", async () => {
    await expect(
      numberSchema.parseAsync({ age: 151, score: 0, duration: 1 }),
    ).rejects.toThrow();
  });

  it("应该接受最大值作为年龄", async () => {
    const result = await numberSchema.parseAsync({
      age: 150,
      score: 0,
      duration: 1,
    });
    expect(result.age).toBe(150);
  });

  it("应该拒绝负数作为分数", async () => {
    await expect(
      numberSchema.parseAsync({ age: 0, score: -1, duration: 1 }),
    ).rejects.toThrow();
  });

  it("应该接受零作为分数", async () => {
    const result = await numberSchema.parseAsync({
      age: 0,
      score: 0,
      duration: 1,
    });
    expect(result.score).toBe(0);
  });

  it("应该接受最大值作为分数", async () => {
    const result = await numberSchema.parseAsync({
      age: 0,
      score: 100,
      duration: 1,
    });
    expect(result.score).toBe(100);
  });

  it("应该拒绝零作为持续时间", async () => {
    await expect(
      numberSchema.parseAsync({ age: 0, score: 0, duration: 0 }),
    ).rejects.toThrow();
  });

  it("应该接受最小值作为持续时间", async () => {
    const result = await numberSchema.parseAsync({
      age: 0,
      score: 0,
      duration: 1,
    });
    expect(result.duration).toBe(1);
  });

  it("应该接受浮点数", async () => {
    const result = await numberSchema.parseAsync({
      age: 25.5,
      score: 85.5,
      duration: 60.5,
    });
    expect(result.age).toBe(25.5);
    expect(result.score).toBe(85.5);
    expect(result.duration).toBe(60.5);
  });
});

describe("边界输入测试 - 日期时间字段", () => {
  const dateSchema = z.object({
    examDate: z.string().datetime(),
    deadline: z.string().datetime(),
  });

  it("应该接受有效的 ISO 8601 日期时间", async () => {
    const result = await dateSchema.parseAsync({
      examDate: new Date().toISOString(),
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(result.examDate).toBeDefined();
    expect(result.deadline).toBeDefined();
  });

  it("应该拒绝无效的日期时间格式", async () => {
    await expect(
      dateSchema.parseAsync({
        examDate: "2024-13-01",
        deadline: new Date().toISOString(),
      }),
    ).rejects.toThrow();
  });

  it("应该接受过去日期", async () => {
    const result = await dateSchema.parseAsync({
      examDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      deadline: new Date().toISOString(),
    });
    expect(result.examDate).toBeDefined();
  });

  it("应该接受未来日期", async () => {
    const result = await dateSchema.parseAsync({
      examDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      deadline: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(result.examDate).toBeDefined();
  });
});

describe("边界输入测试 - 枚举字段", () => {
  const enumSchema = z.object({
    role: z.enum(["Admin", "Candidate"]),
    status: z.enum(["draft", "published", "open", "closed", "archived"]),
  });

  it("应该接受有效的枚举值", async () => {
    const result = await enumSchema.parseAsync({
      role: "Admin",
      status: "published",
    });
    expect(result.role).toBe("Admin");
    expect(result.status).toBe("published");
  });

  it("应该拒绝无效的枚举值", async () => {
    await expect(
      enumSchema.parseAsync({ role: "InvalidRole", status: "published" }),
    ).rejects.toThrow();
    await expect(
      enumSchema.parseAsync({ role: "Admin", status: "invalid_status" }),
    ).rejects.toThrow();
  });

  it("应该区分大小写", async () => {
    await expect(
      enumSchema.parseAsync({ role: "admin", status: "published" }),
    ).rejects.toThrow();
    await expect(
      enumSchema.parseAsync({ role: "Admin", status: "Published" }),
    ).rejects.toThrow();
  });
});

describe("边界输入测试 - 数组字段", () => {
  const arraySchema = z.object({
    tags: z.array(z.string().min(1)).min(1).max(10),
    questionIds: z.array(z.string().uuid()),
  });

  it("应该拒绝空数组", async () => {
    await expect(
      arraySchema.parseAsync({ tags: [], questionIds: [] }),
    ).rejects.toThrow();
  });

  it("应该接受单元素数组", async () => {
    const result = await arraySchema.parseAsync({
      tags: ["tag1"],
      questionIds: [],
    });
    expect(result.tags).toHaveLength(1);
  });

  it("应该拒绝超大数组", async () => {
    const tooManyTags = Array(11).fill("tag");
    await expect(
      arraySchema.parseAsync({ tags: tooManyTags, questionIds: [] }),
    ).rejects.toThrow();
  });

  it("应该接受最大大小的数组", async () => {
    const maxTags = Array(10).fill("tag");
    const result = await arraySchema.parseAsync({
      tags: maxTags,
      questionIds: [],
    });
    expect(result.tags).toHaveLength(10);
  });

  it("应该拒绝数组中的空字符串", async () => {
    await expect(
      arraySchema.parseAsync({ tags: ["tag1", ""], questionIds: [] }),
    ).rejects.toThrow();
  });

  it("应该接受有效的 UUID 数组", async () => {
    const result = await arraySchema.parseAsync({
      tags: ["tag1"],
      questionIds: ["550e8400-e29b-41d4-a716-446655440000"],
    });
    expect(result.questionIds).toHaveLength(1);
  });

  it("应该拒绝无效的 UUID", async () => {
    await expect(
      arraySchema.parseAsync({
        tags: ["tag1"],
        questionIds: ["invalid-uuid"],
      }),
    ).rejects.toThrow();
  });
});

describe("边界输入测试 - 对象字段", () => {
  const objectSchema = z.object({
    metadata: z.record(z.string(), z.string()),
  });

  it("应该接受空对象", async () => {
    const result = await objectSchema.parseAsync({ metadata: {} });
    expect(Object.keys(result.metadata)).toHaveLength(0);
  });

  it("应该接受多个键值对", async () => {
    const result = await objectSchema.parseAsync({
      metadata: {
        key1: "value1",
        key2: "value2",
        key3: "value3",
      },
    });
    expect(Object.keys(result.metadata)).toHaveLength(3);
  });

  it("应该拒绝对象中的非字符串值", async () => {
    await expect(
      objectSchema.parseAsync({
        metadata: { key: 123 },
      }),
    ).rejects.toThrow();
  });
});

describe("边界输入测试 - 可选字段", () => {
  const optionalSchema = z.object({
    required: z.string(),
    optional1: z.string().optional(),
    optional2: z.string().optional(),
  });

  it("应该接受包含所有字段的输入", async () => {
    const result = await optionalSchema.parseAsync({
      required: "value",
      optional1: "optional",
      optional2: "optional",
    });
    expect(result.required).toBe("value");
    expect(result.optional1).toBe("optional");
    expect(result.optional2).toBe("optional");
  });

  it("应该接受缺少可选字段的输入", async () => {
    const result = await optionalSchema.parseAsync({
      required: "value",
    });
    expect(result.required).toBe("value");
    expect(result.optional1).toBeUndefined();
    expect(result.optional2).toBeUndefined();
  });

  it("应该接受部分可选字段", async () => {
    const result = await optionalSchema.parseAsync({
      required: "value",
      optional1: "optional",
    });
    expect(result.required).toBe("value");
    expect(result.optional1).toBe("optional");
    expect(result.optional2).toBeUndefined();
  });

  it("应该拒绝缺少必填字段", async () => {
    await expect(optionalSchema.parseAsync({})).rejects.toThrow();
  });
});
