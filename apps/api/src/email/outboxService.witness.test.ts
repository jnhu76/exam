import { randomUUID } from "node:crypto";
import type {
  EmailSender,
  EmailOutboxStatus,
  OrganizationScope,
  RequestContext,
} from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getIsolatedTestDb } from "@exam/db/testDb";
import { createEmailOutboxRepo } from "@exam/db/repository/emailOutboxRepo";
import { createWorkerHeartbeatRepo } from "@exam/db/repository/workerHeartbeatRepo";
import { emailOutbox } from "@exam/db/schema/pg";
import { createOrganizationRepo } from "@exam/db/repository/organizationRepo";
import type { Database } from "@exam/db/types";
import { FakeEmailSender } from "./senders.js";
import {
  UNDISCLOSED_EMAIL_ERROR,
  projectStoredEmailError,
} from "./sanitizeError.js";
import { EmailOutboxService } from "./outboxService.js";

/**
 * #1012 RED witnesses for `EmailOutboxService` — the ② layer: sender failure
 * → `email_outbox.last_error` persistence (retry AND dead paths) and the
 # dead-letter terminal log payload.
 *
 * Runs against a real isolated PostgreSQL schema (`getIsolatedTestDb`) and
 * asserts the value ACTUALLY READ BACK from the database — not the
 * sanitizer's return value. Markers are synthetic.
 */

const permissions: RequestContext["permissions"] = [];

function createContext(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions,
    sessionId: randomUUID(),
  };
}

const M_SQL = "RED1012-SELECT-grade-FROM-attempts";
const M_BIND = "RED1012-bind-$1::uuid";
const M_SECRET = "RED1012-smtp-secret-9f1zq";
const M_RCPT = "red1012-candidate@example.invalid";
const M_BODY = "RED1012-body-Your-grade-is-72";

const MARKERS = [M_SQL, M_BIND, M_SECRET, M_RCPT, M_BODY];

function leakedIn(value: string | null | undefined): string[] {
  return MARKERS.filter((m) => (value ?? "").includes(m));
}

async function seedRow(
  db: Database,
  orgId: string,
  overrides: Partial<{
    attemptCount: number;
    maxAttempts: number;
    status: EmailOutboxStatus;
  }> = {},
) {
  const ts = new Date();
  const [row] = await db
    .insert(emailOutbox)
    .values({
      id: randomUUID(),
      organizationId: orgId,
      type: "grade_notification",
      recipientEmail: "to@example.com",
      subject: "s",
      bodyText: "t",
      bodyHtml: null,
      status: overrides.status ?? "pending",
      attemptCount: overrides.attemptCount ?? 0,
      maxAttempts: overrides.maxAttempts ?? 3,
      lastError: null,
      nextAttemptAt: null,
      lockedAt: null,
      lockedBy: null,
      providerMessageId: null,
      dedupeKey: null,
      sentAt: null,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning();
  return row!;
}

describe("EmailOutboxService — #1012 RED witnesses (real PostgreSQL)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let ctx: RequestContext;
  let orgScope: OrganizationScope;
  let repo: ReturnType<typeof createEmailOutboxRepo>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("api-email-outbox-witness");
    db = result.db;
    cleanup = result.cleanup;
    const organizationRepo = createOrganizationRepo(db);
    const org = await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "org",
        displayName: "Org",
        slug: `slug-${randomUUID().slice(0, 8)}`,
      },
    );
    ctx = createContext(org.id);
    orgScope = { organizationId: org.id };
    repo = createEmailOutboxRepo(db);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("witness: a provider Error's free text is persisted verbatim into email_outbox.last_error on the retry path", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const row = await seedRow(db, ctx.organizationId, {
      attemptCount: 0,
      maxAttempts: 3,
    });
    const sender: EmailSender = {
      async send() {
        throw new Error(
          `provider echoed: sql=${M_SQL} bind=${M_BIND} secret=${M_SECRET} rcpt=${M_RCPT} body=${M_BODY}`,
        );
      },
    };
    const service = new EmailOutboxService({
      repo,
      ctx: orgScope,
      sender,
      retryBaseSeconds: 60,
    });
    const result = await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "red-witness-retry",
    });
    expect(result.retryWait).toBe(1);
    const updated = await repo.findById(ctx, row.id);
    const leaked = leakedIn(updated?.lastError);
    expect(
      leaked,
      `markers persisted into email_outbox.last_error: ${leaked.join(", ")}\nlastError: ${updated?.lastError}`,
    ).toEqual([]);
  });

  it("witness: a plain string rejection is persisted verbatim into email_outbox.last_error on the dead path", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const row = await seedRow(db, ctx.organizationId, {
      attemptCount: 2,
      maxAttempts: 3,
    });
    const sender: EmailSender = {
      async send() {
        // Non-Error thrown value: a raw string (the #998 leak class).
        throw `SMTP banner dump: ${M_SQL} ${M_BIND}`;
      },
    };
    const service = new EmailOutboxService({
      repo,
      ctx: orgScope,
      sender,
      retryBaseSeconds: 60,
    });
    const result = await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "red-witness-dead",
    });
    expect(result.dead).toBe(1);
    const updated = await repo.findById(ctx, row.id);
    const leaked = leakedIn(updated?.lastError);
    expect(
      leaked,
      `markers persisted into email_outbox.last_error (dead): ${leaked.join(", ")}\nlastError: ${updated?.lastError}`,
    ).toEqual([]);
  });

  it("witness: the dead-letter terminal log payload carries the provider's free text", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    await seedRow(db, ctx.organizationId, {
      attemptCount: 2,
      maxAttempts: 3,
    });
    const logged: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const sender: EmailSender = {
      async send() {
        throw new Error(
          `provider echoed: sql=${M_SQL} rcpt=${M_RCPT} secret=${M_SECRET}`,
        );
      },
    };
    const service = new EmailOutboxService({
      repo,
      ctx: orgScope,
      sender,
      retryBaseSeconds: 60,
      logger: {
        error: (obj, msg) => logged.push({ obj, msg }),
      },
    });
    const result = await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "red-witness-log",
    });
    expect(result.dead).toBe(1);
    expect(logged).toHaveLength(1);
    const serialized = JSON.stringify(logged[0]);
    const leaked = MARKERS.filter((m) => serialized.includes(m));
    expect(
      leaked,
      `markers reached the dead-letter log payload: ${leaked.join(", ")}\npayload: ${serialized}`,
    ).toEqual([]);
  });

  it("worker_heartbeats storage is a documented passthrough; safety comes from writers + the read projection (⑤ + B3)", async () => {
    // #1012 as-built architecture note: the repo stores what it is given —
    // a packages/db repo cannot own the apps/api email privacy policy (that
    // would be a second policy owner / inverted dependency). Therefore:
    //  (a) the seam passes bytes through verbatim (the reason the read-side
    //      projection must treat stored values as untrusted), and
    //  (b) the policy's read projection maps that same dirty value to the
    //      fixed undisclosed label, so it can never be served.
    // The WRITER side (both hosts hand only safe representations to this
    // seam) is proven by the host-level witnesses in
    // emailOutboxLoop.witness.test.ts / emailDeliveryWorker.witness.test.ts.
    const heartbeatRepo = createWorkerHeartbeatRepo(db);
    const dirty = `legacy worker failure: sql=${M_SQL} bind=${M_BIND} secret=${M_SECRET} rcpt=${M_RCPT}`;
    await heartbeatRepo.upsert({
      workerName: "email-delivery",
      workerInstanceId: "red-witness-heartbeat-storage",
      lastPollAt: new Date(),
      lastSuccessAt: null,
      lastErrorAt: new Date(),
      lastError: dirty,
    });
    const row = await heartbeatRepo.findLatestByName("email-delivery");
    // (a) passthrough semantics — the untrusted input contract for readers.
    expect(row?.lastError).toBe(dirty);
    // (b) the read-side projection never discloses it.
    expect(projectStoredEmailError(row?.lastError ?? null)).toBe(
      UNDISCLOSED_EMAIL_ERROR,
    );
    const leaked = leakedIn(projectStoredEmailError(row?.lastError ?? null));
    expect(leaked).toEqual([]);
  });

  // ── B4: organization isolation (A/B repo scopes, interleaved) ──────

  it("B4: interleaved A/B organization scopes never cross — each org sees only its own rows and safe lastErrors", async () => {
    const organizationRepo = createOrganizationRepo(db);
    const orgA = await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "org-a",
        displayName: "Org A",
        slug: `slug-a-${randomUUID().slice(0, 8)}`,
      },
    );
    const orgB = await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "org-b",
        displayName: "Org B",
        slug: `slug-b-${randomUUID().slice(0, 8)}`,
      },
    );

    const rowA = await seedRow(db, orgA.id);
    const rowB = await seedRow(db, orgB.id);

    // Org A delivers successfully; org B's delivery fails with marker text.
    const serviceA = new EmailOutboxService({
      repo,
      ctx: { organizationId: orgA.id },
      sender: {
        async send() {
          return { providerMessageId: null };
        },
      },
      retryBaseSeconds: 60,
    });
    await serviceA.processDueEmails({
      now: new Date(),
      limit: 10,
      workerInstanceId: "red-witness-org-a",
    });

    const serviceB = new EmailOutboxService({
      repo,
      ctx: { organizationId: orgB.id },
      sender: {
        async send() {
          throw new Error(`provider echoed: sql=${M_SQL} rcpt=${M_RCPT}`);
        },
      },
      retryBaseSeconds: 60,
    });
    const resultB = await serviceB.processDueEmails({
      now: new Date(),
      limit: 10,
      workerInstanceId: "red-witness-org-b",
    });

    const updatedA = await repo.findById({ organizationId: orgA.id }, rowA.id);
    const updatedB = await repo.findById({ organizationId: orgB.id }, rowB.id);
    // A's row was delivered and untouched by B's failure.
    expect(updatedA?.status).toBe("sent");
    expect(updatedA?.lastError).toBeNull();
    // B's row failed within B's scope, with the safe classification only.
    expect(resultB.retryWait).toBe(1);
    expect(updatedB?.status).toBe("retry_wait");
    expect(updatedB?.lastError).toBe("email_error:internal_error");
    const leaked = leakedIn(
      `${updatedA?.lastError ?? ""}${updatedB?.lastError ?? ""}`,
    );
    expect(leaked).toEqual([]);
  });

  // ── B4: observation-failure isolation at the modified emission boundary ──

  it("B4: a synchronously throwing dead-letter logger changes no DB transition, causes no spurious retry, and does not stop later emails", async () => {
    // Fresh org scope so only this test's rows are due (earlier witnesses in
    // this file leave re-due retry_wait rows in the shared org).
    const organizationRepo = createOrganizationRepo(db);
    const org = await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "org-obs-fail",
        displayName: "Org ObsFail",
        slug: `slug-obs-${randomUUID().slice(0, 8)}`,
      },
    );
    const now = new Date();
    const first = await seedRow(db, org.id, {
      attemptCount: 2,
      maxAttempts: 3,
    });
    const second = await seedRow(db, org.id, {
      attemptCount: 2,
      maxAttempts: 3,
    });
    let calls = 0;
    const service = new EmailOutboxService({
      repo,
      ctx: { organizationId: org.id },
      sender: new FakeEmailSender("failure"),
      retryBaseSeconds: 60,
      logger: {
        error: () => {
          calls += 1;
          // Synchronous emission failure on EVERY dead-letter line.
          throw new Error("log transport exploded");
        },
      },
    });
    const result = await service.processDueEmails({
      now,
      limit: 10,
      workerInstanceId: "red-witness-obs-fail",
    });
    // The emission was attempted for both dead transitions and both failed,
    // yet the already-committed DB transitions stand and neither row was
    // re-queued or retried.
    expect(calls).toBe(2);
    expect(result.dead).toBe(2);
    expect(result.retryWait).toBe(0);
    const deadFirst = await repo.findById({ organizationId: org.id }, first.id);
    const deadSecond = await repo.findById(
      { organizationId: org.id },
      second.id,
    );
    expect(deadFirst?.status).toBe("dead");
    expect(deadSecond?.status).toBe("dead");
    expect(deadFirst?.lastError).toBe("email_error:internal_error");
    expect(deadSecond?.lastError).toBe("email_error:internal_error");
  });
});
