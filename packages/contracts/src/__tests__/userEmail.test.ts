import { describe, it, expect } from "vitest";
import {
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
  UserSchema,
} from "../user.js";
import {
  CreateCandidateRequestSchema,
  UpdateCandidateRequestSchema,
  CandidateSchema,
} from "../candidate.js";

// Slice 1 — users.email is an OPTIONAL recipient source for notifications.
// The seam: every Admin write surface that creates a user (POST /users,
// POST /candidates) or edits one (PATCH /users/:id, PATCH /candidates/:id)
// accepts an optional `email` field. The contract:
//   - blank/whitespace-only -> normalized away (treated as absent on write)
//   - valid email -> trimmed (case-preserved)
//   - malformed -> rejected
//   - candidate without email remains valid
// Per the P5-N1-R0 §13 frozen contract: email is optional, not for login,
// not unique, blank maps to null, no invitation/verification semantics.

describe("CreateUserRequestSchema.email (optional recipient source)", () => {
  const base = {
    username: "newuser",
    password: "password123",
    name: "New User",
    role: "Admin" as const,
  };

  it("accepts a request without email (email is optional)", () => {
    const result = CreateUserRequestSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeUndefined();
    }
  });

  it("accepts and normalizes a valid email (trim-only, case-preserved)", () => {
    const result = CreateUserRequestSchema.safeParse({
      ...base,
      email: "  Alice@Example.COM  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("Alice@Example.COM");
    }
  });

  it("normalizes blank/whitespace-only email to undefined on write", () => {
    const result = CreateUserRequestSchema.safeParse({
      ...base,
      email: "   ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeUndefined();
    }
  });

  it("normalizes empty string email to undefined on write", () => {
    const result = CreateUserRequestSchema.safeParse({
      ...base,
      email: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeUndefined();
    }
  });

  it("rejects a malformed email", () => {
    const result = CreateUserRequestSchema.safeParse({
      ...base,
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an email with no local part", () => {
    const result = CreateUserRequestSchema.safeParse({
      ...base,
      email: "@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an email longer than 320 characters", () => {
    const longLocal = "a".repeat(320);
    const result = CreateUserRequestSchema.safeParse({
      ...base,
      email: `${longLocal}@example.com`,
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateUserRequestSchema.email (optional recipient source)", () => {
  it("accepts a valid email and normalizes it", () => {
    const result = UpdateUserRequestSchema.safeParse({
      email: "Bob@Example.com",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("Bob@Example.com");
    }
  });

  it("normalizes blank email to undefined (clear email on update)", () => {
    const result = UpdateUserRequestSchema.safeParse({ email: "  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeUndefined();
    }
  });

  it("accepts update without email (no-op on the field)", () => {
    const result = UpdateUserRequestSchema.safeParse({ name: "Renamed" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeUndefined();
    }
  });

  it("rejects malformed email", () => {
    const result = UpdateUserRequestSchema.safeParse({ email: "bad" });
    expect(result.success).toBe(false);
  });
});

describe("CreateCandidateRequestSchema.email (optional recipient source)", () => {
  const base = {
    username: "cand001",
    password: "password123",
    name: "Candidate One",
    fields: {},
  };

  it("accepts a candidate without email (Inbox-only recipient)", () => {
    const result = CreateCandidateRequestSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts and normalizes a candidate email", () => {
    const result = CreateCandidateRequestSchema.safeParse({
      ...base,
      email: "  Cand@Example.COM ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("Cand@Example.COM");
    }
  });

  it("rejects malformed candidate email", () => {
    const result = CreateCandidateRequestSchema.safeParse({
      ...base,
      email: "no-at-sign",
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateCandidateRequestSchema.email", () => {
  it("accepts and normalizes a candidate email on update", () => {
    const result = UpdateCandidateRequestSchema.safeParse({
      email: " Updated@Example.com ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("Updated@Example.com");
    }
  });
});

describe("UserSchema / CandidateSchema email exposure (admin read DTO)", () => {
  // The read DTO exposes email (nullable) so Admin can see/correct it.
  // Candidate self-view (/auth/me) is NOT affected — email is absent there.

  it("UserSchema accepts a payload with null email", () => {
    const result = UserSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      username: "admin",
      name: "Admin",
      role: "Admin",
      isActive: true,
      email: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("UserSchema accepts a payload with a normalized email", () => {
    const result = UserSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      username: "admin",
      name: "Admin",
      role: "Admin",
      isActive: true,
      email: "admin@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});
