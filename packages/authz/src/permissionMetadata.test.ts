import { describe, it, expect } from "vitest";
import { Permission } from "./catalog.js";
import {
  PermissionCategory,
  PERMISSION_METADATA,
  permissionMetadata,
} from "./permissionMetadata.js";

describe("#298 permission metadata — exhaustive projection", () => {
  it("covers every permission key exactly once (no orphan, no gap)", () => {
    const catalogKeys = Object.values(Permission).sort();
    const metadataKeys = Object.keys(PERMISSION_METADATA).sort();
    expect(metadataKeys).toEqual(catalogKeys);
  });

  it("maps every metadata entry to a known category", () => {
    const categories = new Set<string>(Object.values(PermissionCategory));
    for (const meta of Object.values(PERMISSION_METADATA)) {
      expect(categories.has(meta.category)).toBe(true);
    }
  });

  it("returns metadata for a catalog key via the accessor", () => {
    expect(permissionMetadata(Permission.UserView).category).toBe("user");
    expect(permissionMetadata(Permission.SystemAutoSubmit).category).toBe(
      "system",
    );
  });

  it("groups by the ADR §4.1–4.13 domains (spot check)", () => {
    expect(PERMISSION_METADATA[Permission.AuditLogView].category).toBe("user");
    expect(PERMISSION_METADATA[Permission.ExamEnrollmentManage].category).toBe(
      "exam",
    );
    expect(
      PERMISSION_METADATA[Permission.ExamGraderAssignmentManage].category,
    ).toBe("assignment");
    expect(PERMISSION_METADATA[Permission.ScoreExport].category).toBe("score");
  });
});
