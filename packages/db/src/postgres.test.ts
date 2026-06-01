import { describe, expect, it } from "vitest";
import { isPostgresqlUrl } from "./postgres.js";

describe("postgres helpers", () => {
  describe("isPostgresqlUrl", () => {
    it("returns true for postgresql:// URLs", () => {
      expect(isPostgresqlUrl("postgresql://user:pass@host:5432/db")).toBe(true);
    });

    it("returns true for postgres:// URLs", () => {
      expect(isPostgresqlUrl("postgres://user:pass@host:5432/db")).toBe(true);
    });

    it("returns false for sqlite URLs", () => {
      expect(isPostgresqlUrl("sqlite:./dev.db")).toBe(false);
    });

    it("returns false for memory URLs", () => {
      expect(isPostgresqlUrl(":memory:")).toBe(false);
    });

    it("returns false for file paths", () => {
      expect(isPostgresqlUrl("./dev.db")).toBe(false);
    });
  });
});
