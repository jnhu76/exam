import { describe, it, expect } from "vitest";
import { escapeCSVValue, generateCSV } from "./csv.js";

describe("escapeCSVValue", () => {
  it("returns plain string for safe input", () => {
    expect(escapeCSVValue("hello")).toBe("hello");
  });

  it("wraps and doubles quotes when the value contains a comma", () => {
    expect(escapeCSVValue("a,b")).toBe('"a,b"');
  });

  it("wraps and doubles quotes when the value contains a double quote", () => {
    expect(escapeCSVValue('he said "hi"')).toBe('"he said ""hi"""');
  });

  it("wraps when the value contains a newline", () => {
    expect(escapeCSVValue("line1\nline2")).toBe('"line1\nline2"');
  });

  it("wraps when the value contains a carriage return", () => {
    expect(escapeCSVValue("line1\rline2")).toBe('"line1\rline2"');
  });

  it("returns empty string for null", () => {
    expect(escapeCSVValue(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(escapeCSVValue(undefined)).toBe("");
  });

  // CSV injection mitigation: prefix dangerous leading characters with single quote
  // OWASP Formula Injection / CSV Injection: =, +, -, @, \t, \r prefixes
  it("prefixes leading '=' with a single quote to mitigate CSV injection", () => {
    expect(escapeCSVValue("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
  });

  it("prefixes leading '+' with a single quote to mitigate CSV injection", () => {
    expect(escapeCSVValue("+1234")).toBe("'+1234");
  });

  it("prefixes leading '-' with a single quote to mitigate CSV injection", () => {
    expect(escapeCSVValue("-2+3")).toBe("'-2+3");
  });

  it("prefixes leading '@' with a single quote to mitigate CSV injection", () => {
    expect(escapeCSVValue("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
  });

  it("prefixes leading tab with a single quote to mitigate CSV injection", () => {
    expect(escapeCSVValue("\tsneaky")).toBe("'\tsneaky");
  });

  it("prefixes leading carriage return with a single quote to mitigate CSV injection", () => {
    // \r alone still requires quoting because it is a CSV-special character
    const out = escapeCSVValue("\rsneaky");
    expect(out.startsWith('"')).toBe(true);
    // After the opening quote, the dangerous-prefix '\r' must be preceded by a single quote
    expect(out).toContain("'\r");
  });

  it("does not prefix an internal '=' character", () => {
    expect(escapeCSVValue("a=b")).toBe("a=b");
  });

  it("combines injection-prefix with quote-wrapping when needed", () => {
    // Leading '=' AND an embedded comma require both prefix and wrap
    const out = escapeCSVValue("=1+1,boom");
    expect(out.startsWith('"')).toBe(true);
    expect(out).toContain("'=");
  });
});

describe("generateCSV", () => {
  it("renders headers and rows with CSV-injection-safe escaping", () => {
    const csv = generateCSV(
      ["name", "formula"],
      [{ name: "Alice", formula: "=1+1" }],
    );
    const [headerLine, dataLine] = csv.split("\n");
    expect(headerLine).toBe("name,formula");
    expect(dataLine).toBe("Alice,'=1+1");
  });

  it("escapes header cells when they contain dangerous prefixes", () => {
    const csv = generateCSV(["=danger"], []);
    expect(csv).toBe("'=danger");
  });
});
