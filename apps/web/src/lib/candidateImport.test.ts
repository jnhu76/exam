import { describe, expect, it } from "vitest";
import {
  parseCsvLine,
  resolveHeaders,
  parseImportCsv,
  detectDuplicate,
} from "./candidateImport";
import type { CandidateFieldConfig } from "./candidateImport";

const sampleFields: CandidateFieldConfig[] = [
  {
    name: "studentId",
    label: "学号",
    fieldType: "text",
    required: true,
    unique: true,
  },
  {
    name: "department",
    label: "院系",
    fieldType: "text",
    required: false,
    unique: false,
  },
  {
    name: "grade",
    label: "年级",
    fieldType: "text",
    required: false,
    unique: false,
  },
];

describe("parseCsvLine", () => {
  it("parses simple comma-separated values", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted values with commas", () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("handles escaped double quotes", () => {
    expect(parseCsvLine('a,"b""c",d')).toEqual(["a", 'b"c', "d"]);
  });

  it("trims whitespace", () => {
    expect(parseCsvLine(" a , b , c ")).toEqual(["a", "b", "c"]);
  });
});

describe("resolveHeaders", () => {
  it("maps english header names directly", () => {
    const result = resolveHeaders(
      ["username", "password", "name", "studentId", "department"],
      sampleFields,
    );
    expect(result).toEqual({
      username: "username",
      password: "password",
      name: "name",
      studentId: "studentId",
      department: "department",
    });
  });

  it("maps chinese labels to field names", () => {
    const result = resolveHeaders(
      ["用户名", "密码", "姓名", "学号", "院系", "年级"],
      sampleFields,
    );
    expect(result).toEqual({
      用户名: "username",
      密码: "password",
      姓名: "name",
      学号: "studentId",
      院系: "department",
      年级: "grade",
    });
  });

  it("passes through unknown headers as-is", () => {
    const result = resolveHeaders(["username", "customField"], sampleFields);
    expect(result).toEqual({
      username: "username",
      customField: "customField",
    });
  });
});

describe("parseImportCsv", () => {
  it("parses CSV with english headers", () => {
    const csv = `username,password,name,studentId,department,grade
stu001,123456,张三,20240001,计算机系,2024级
stu002,123456,李四,20240002,软件工程,2024级`;
    const result = parseImportCsv(csv, sampleFields);
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(result.rows[0]).toEqual({
      username: "stu001",
      password: "123456",
      name: "张三",
      fields: {
        studentId: "20240001",
        department: "计算机系",
        grade: "2024级",
      },
    });
  });

  it("parses CSV with chinese label headers", () => {
    const csv = `用户名,密码,姓名,学号,院系,年级
stu001,123456,张三,20240001,计算机系,2024级`;
    const result = parseImportCsv(csv, sampleFields);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.username).toBe("stu001");
    expect(result.rows[0]!.name).toBe("张三");
    expect(result.rows[0]!.fields.studentId).toBe("20240001");
  });

  it("strips BOM from first header", () => {
    const csv = `\uFEFFusername,password,name,studentId
stu001,123456,张三,20240001`;
    const result = parseImportCsv(csv, sampleFields);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.username).toBe("stu001");
  });

  it("returns empty result for header-only CSV", () => {
    const csv = "username,password,name";
    const result = parseImportCsv(csv, sampleFields);
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("returns empty result for empty string", () => {
    const result = parseImportCsv("", sampleFields);
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("converts number fields", () => {
    const numericFields: CandidateFieldConfig[] = [
      {
        name: "score",
        label: "分数",
        fieldType: "number",
        required: false,
        unique: false,
      },
    ];
    const csv = "username,password,name,score\nstu001,123456,张三,95";
    const result = parseImportCsv(csv, numericFields);
    expect(result.rows[0]!.fields.score).toBe(95);
  });

  it("truncates at MAX_IMPORT_ROWS and sets truncated flag", () => {
    const header = "username,password,name";
    const lines = Array.from(
      { length: 600 },
      (_, i) => `stu${i},123456,user${i}`,
    );
    const csv = `${header}\n${lines.join("\n")}`;
    const result = parseImportCsv(csv, []);
    expect(result.rows).toHaveLength(500);
    expect(result.truncated).toBe(true);
    expect(result.totalLines).toBe(600);
  });
});

describe("detectDuplicate", () => {
  const existing = [
    { username: "stu001", fields: { studentId: "20240001" } },
    { username: "stu002", fields: { studentId: "20240002" } },
  ];

  it("detects duplicate by unique identity field", () => {
    const row = {
      username: "stu003",
      password: "123456",
      name: "新用户",
      fields: { studentId: "20240001" },
    };
    expect(detectDuplicate(row, sampleFields, existing)).toBe(true);
  });

  it("detects duplicate by username when no identity field matches", () => {
    const row = {
      username: "stu001",
      password: "123456",
      name: "新用户",
      fields: { studentId: "20240099" },
    };
    expect(detectDuplicate(row, sampleFields, existing)).toBe(true);
  });

  it("returns false for truly new candidates", () => {
    const row = {
      username: "stu099",
      password: "123456",
      name: "全新用户",
      fields: { studentId: "20240099" },
    };
    expect(detectDuplicate(row, sampleFields, existing)).toBe(false);
  });

  it("works with empty field configs (no identity field)", () => {
    const row = {
      username: "stu001",
      password: "123456",
      name: "张三",
      fields: {},
    };
    expect(detectDuplicate(row, [], existing)).toBe(true);
  });

  it("works with empty existing list", () => {
    const row = {
      username: "stu001",
      password: "123456",
      name: "张三",
      fields: { studentId: "20240001" },
    };
    expect(detectDuplicate(row, sampleFields, [])).toBe(false);
  });
});
