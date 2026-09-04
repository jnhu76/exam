import { describe, it, expect } from "vitest";
import {
  NotificationSchema,
  NotificationListQuerySchema,
  UnreadCountResponseSchema,
  NotificationListResponseSchema,
  NOTIFICATION_ACTION_PATH_PATTERN,
  isNotificationActionPath,
} from "../notification.js";

// Slice 3 — notification contracts (P5-N1 Inbox API request/response shapes).
//
// V1 contract (P5-N1-R0 §19 — frozen):
//   - Pagination REUSES the repo's offset/page convention
//     (PaginationParamsSchema), NOT an opaque base64url cursor.
//   - Endpoints: GET /notifications, GET /notifications/unread-count,
//     POST /notifications/:id/read, POST /notifications/read-all.
//   - Optional ?unread=true server-side filter on the list.
//   - Mark-read is idempotent (no 409).
//   - Action path is a site-relative `/exam/:attemptId/result` string built
//     by a trusted server builder; the contract layer carries a V1 pattern
//     constant used by the actionLink validator (P5-N1-I2) and the render-time
//     revalidation. This test pins the pattern so the validator and the
//     stored rows cannot drift apart.

describe("NotificationSchema (read DTO)", () => {
  const base = {
    id: "00000000-0000-4000-8000-000000000001",
    organizationId: "00000000-0000-4000-8000-000000000002",
    recipientUserId: "00000000-0000-4000-8000-000000000003",
    type: "result_published",
    title: "考试结果已发布",
    body: "您的考试结果已发布，点击查看。",
    actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
    createdAt: "2026-07-25T00:00:00.000Z",
    readAt: null,
  };

  it("accepts a minimal unread notification", () => {
    const result = NotificationSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts a notification with a result action path", () => {
    const result = NotificationSchema.safeParse({
      ...base,
      actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a read notification (readAt set)", () => {
    const result = NotificationSchema.safeParse({
      ...base,
      readAt: "2026-07-25T01:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a null actionPath (V1 NOT NULL contract)", () => {
    const result = NotificationSchema.safeParse({ ...base, actionPath: null });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown notification type", () => {
    // "exam_cancelled" is still deferred — adding it to the union requires
    // its own operational wiring (#402 brake).
    const result = NotificationSchema.safeParse({
      ...base,
      type: "exam_cancelled",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a notification missing required title", () => {
    const { title: _omit, ...withoutTitle } = base;
    void _omit;
    const result = NotificationSchema.safeParse(withoutTitle);
    expect(result.success).toBe(false);
  });
});

describe("NotificationListQuerySchema", () => {
  it("defaults page=1 pageSize=20 unread=undefined", () => {
    const result = NotificationListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
      expect(result.data.unread).toBeUndefined();
    }
  });

  it("accepts page/pageSize and unread=true", () => {
    const result = NotificationListQuerySchema.safeParse({
      page: "2",
      pageSize: "50",
      unread: "true",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.pageSize).toBe(50);
      // The filter is a one-way literal "true" switch (a string, not coerced
      // to boolean). The route checks `query.unread === "true"`.
      expect(result.data.unread).toBe("true");
    }
  });

  it("rejects pageSize > 100 (bounded)", () => {
    const result = NotificationListQuerySchema.safeParse({ pageSize: "101" });
    expect(result.success).toBe(false);
  });

  it("rejects page < 1", () => {
    const result = NotificationListQuerySchema.safeParse({ page: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects unread values other than 'true'", () => {
    // The filter is a one-way switch: present-and-true means "unread only".
    // Anything else is rejected so the API cannot accidentally invert it.
    const r1 = NotificationListQuerySchema.safeParse({ unread: "false" });
    expect(r1.success).toBe(false);
    const r2 = NotificationListQuerySchema.safeParse({ unread: "yes" });
    expect(r2.success).toBe(false);
  });
});

describe("UnreadCountResponseSchema", () => {
  it("accepts { count: 0 }", () => {
    const result = UnreadCountResponseSchema.safeParse({ count: 0 });
    expect(result.success).toBe(true);
  });

  it("accepts a positive integer count", () => {
    const result = UnreadCountResponseSchema.safeParse({ count: 42 });
    expect(result.success).toBe(true);
  });

  it("rejects a negative count", () => {
    const result = UnreadCountResponseSchema.safeParse({ count: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer count", () => {
    const result = UnreadCountResponseSchema.safeParse({ count: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe("NotificationListResponseSchema (paginated)", () => {
  it("accepts an empty page", () => {
    const result = NotificationListResponseSchema.safeParse({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a page with one item", () => {
    const result = NotificationListResponseSchema.safeParse({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          organizationId: "00000000-0000-4000-8000-000000000002",
          recipientUserId: "00000000-0000-4000-8000-000000000003",
          type: "result_published",
          title: "t",
          body: "b",
          actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
          createdAt: "2026-07-25T00:00:00.000Z",
          readAt: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    expect(result.success).toBe(true);
  });
});

describe("NOTIFICATION_ACTION_PATH_PATTERN / isNotificationActionPath", () => {
  // P5-N1-R0 §16 (result path), extended additively for exam_assigned
  // (#402/#299): /exam/list. The pattern is the single source of truth shared
  // by the trusted builders, the write-time validator, and the render-time
  // revalidator. Every accepted shape maps to an authorized candidate route.

  it("pattern matches the canonical result route", () => {
    expect(
      NOTIFICATION_ACTION_PATH_PATTERN.test(
        "/exam/00000000-0000-4000-8000-00000000000a/result",
      ),
    ).toBe(true);
  });

  it("isNotificationActionPath accepts a canonical result path", () => {
    expect(
      isNotificationActionPath(
        "/exam/00000000-0000-4000-8000-00000000000a/result",
      ),
    ).toBe(true);
  });

  it("accepts the canonical exam_assigned list path", () => {
    expect(isNotificationActionPath("/exam/list")).toBe(true);
    expect(NOTIFICATION_ACTION_PATH_PATTERN.test("/exam/list")).toBe(true);
  });

  it("rejects /exam/list with a trailing segment (no open prefix)", () => {
    expect(isNotificationActionPath("/exam/list/extra")).toBe(false);
  });

  it("rejects /exam/list with a trailing slash", () => {
    expect(isNotificationActionPath("/exam/list/")).toBe(false);
  });

  it("rejects arbitrary same-prefix shapes", () => {
    expect(isNotificationActionPath("/exam/anything")).toBe(false);
    expect(isNotificationActionPath("/exam/listx")).toBe(false);
  });

  it("rejects an external URL", () => {
    expect(isNotificationActionPath("https://evil.example/exam/x/result")).toBe(
      false,
    );
    expect(isNotificationActionPath("https://evil.example/exam/list")).toBe(
      false,
    );
  });

  it("rejects a protocol-relative URL", () => {
    expect(isNotificationActionPath("//evil.example/exam/x/result")).toBe(
      false,
    );
    expect(isNotificationActionPath("//evil.example/exam/list")).toBe(false);
  });

  it("rejects dot-dot traversal", () => {
    expect(isNotificationActionPath("/exam/../admin/users/result")).toBe(false);
    expect(isNotificationActionPath("/exam/../admin")).toBe(false);
  });

  it("rejects a backslash", () => {
    expect(isNotificationActionPath("/exam/x\\result")).toBe(false);
  });

  it("rejects percent-encoded traversal", () => {
    expect(isNotificationActionPath("/exam/%2e%2e/admin/result")).toBe(false);
  });

  it("rejects a control character", () => {
    expect(isNotificationActionPath("/exam/x/result\n")).toBe(false);
    expect(isNotificationActionPath("/exam/list\r")).toBe(false);
  });

  it("rejects an unknown route prefix", () => {
    expect(isNotificationActionPath("/admin/exams/123")).toBe(false);
    expect(isNotificationActionPath("/admin")).toBe(false);
  });
});
