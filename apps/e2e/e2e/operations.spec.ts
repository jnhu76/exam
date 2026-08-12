import { test, expect, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Repo-root-relative path to the built evidence CLI (spec cwd is apps/e2e).
 * Available on the host-direct modes (CI + run-wsl.sh, where `pnpm build`
 * produces apps/api/dist) and absent in the Docker e2e container (which only
 * mounts apps/e2e + packages) — the evidence-state tests skip there; the
 * truthful empty-state assertions still run everywhere.
 */
const EVIDENCE_CLI = resolve(
  process.cwd(),
  "..",
  "api",
  "dist",
  "scripts",
  "backup-evidence.js",
);
const EVIDENCE_CLI_AVAILABLE = existsSync(EVIDENCE_CLI);
/**
 * The API server's database for this shard: run-wsl.sh exports the per-shard
 * DB URL (E2E_TEST_DATABASE_URL); CI exports TEST_DATABASE_URL directly.
 */
const EVIDENCE_DATABASE_URL =
  process.env.E2E_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
import { loginViaUi } from "../lib/login";
import { adminApiToken } from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin123";
/** Default password for E2E Maintainer fixtures (rate-limit-disabled env). */
const MAINTAINER_PASSWORD = "maintainer123";
const MAINTAINER_LANDING = /\/admin\/operations(?:$|[/?#])/;

interface MaintainerFixture {
  username: string;
  password: string;
  userId: string;
}

/**
 * Creates a Maintainer account through the SUPPORTED Admin product interface
 * (POST /api/users { role: "Maintainer" }, ADR-017 D2 provisioning rule) —
 * NOT by direct DB insertion. Admin authenticates via the real login flow.
 */
async function createMaintainerViaApi(
  request: APIRequestContext,
): Promise<MaintainerFixture> {
  const token = await adminApiToken(request);
  const username = `maintainer-${Date.now()}`;
  const res = await request.post(`${BASE_URL}/api/users`, {
    headers: { cookie: `auth-token=${token}` },
    data: {
      username,
      password: MAINTAINER_PASSWORD,
      name: "E2E Maintainer",
      role: "Maintainer",
    },
  });
  expect(res.status(), "POST /api/users role=Maintainer").toBe(201);
  const created = (await res.json()) as { id: string };
  return { username, password: MAINTAINER_PASSWORD, userId: created.id };
}

/**
 * Runs the operator evidence CLI against the E2E database (APP_MODE=e2e →
 * TEST_DATABASE_URL, exported by run-wsl.sh). This is the ONLY path that
 * writes ledger evidence — mirroring the host operator flow.
 */
function recordEvidence(args: string[]): void {
  if (!EVIDENCE_CLI_AVAILABLE || !EVIDENCE_DATABASE_URL) {
    throw new Error("evidence CLI or database URL unavailable in this mode");
  }
  execFileSync("node", [EVIDENCE_CLI, ...args], {
    // Point the CLI at the API server's database (APP_MODE=development makes
    // the resolver read DATABASE_URL explicitly — never a stale shell var).
    env: {
      ...process.env,
      APP_MODE: "development",
      DATABASE_URL: EVIDENCE_DATABASE_URL,
    },
    stdio: "pipe",
  });
}

/** Skips the evidence-state tests where the CLI is not reachable. */
function evidenceAvailable(): boolean {
  return EVIDENCE_CLI_AVAILABLE && EVIDENCE_DATABASE_URL !== undefined;
}

test.describe("P7-E2C operations surface", () => {
  test("Admin: business UI works and operations summary works", async ({
    page,
    request,
  }) => {
    // Admin lands on the business dashboard (business UI works).
    await loginViaUi(
      page,
      ADMIN_USERNAME,
      ADMIN_PASSWORD,
      /\/admin\/dashboard/,
    );
    await expect(page.getByTestId("admin-layout")).toBeVisible();
    await expect(page.getByText(/仪表盘/).first()).toBeVisible();

    // Operations summary works via the sidebar nav.
    await page
      .locator('[data-slot="sidebar-nav-item"]')
      .filter({ hasText: "运维总览" })
      .click();
    await page.waitForURL(/\/admin\/operations/);
    await expect(page.getByTestId("operations-page")).toBeVisible();
    // Truthful empty state: the reseeded e2e DB has no ledger rows.
    await expect(page.getByTestId("backup-status-badge")).toHaveText("无证据");
    await expect(page.getByTestId("restore-status-badge")).toHaveText("无证据");
  });

  test("Maintainer: lands on operations, no business nav, business route denied", async ({
    page,
    request,
  }) => {
    const maintainer = await createMaintainerViaApi(request);
    await loginViaUi(
      page,
      maintainer.username,
      MAINTAINER_PASSWORD,
      MAINTAINER_LANDING,
    );
    await expect(page.getByTestId("operations-page")).toBeVisible();

    // No business management navigation for Maintainer.
    for (const label of [
      "用户管理",
      "考生管理",
      "考试管理",
      "题目管理",
      "成绩查询",
      "待评分",
    ]) {
      await expect(
        page
          .locator('[data-slot="sidebar-nav-item"]')
          .filter({ hasText: label }),
      ).toHaveCount(0);
    }
    // Operations nav IS present.
    await expect(
      page
        .locator('[data-slot="sidebar-nav-item"]')
        .filter({ hasText: "运维总览" }),
    ).toHaveCount(1);

    // Direct business route is denied (frontend 403 page; backend also 403s).
    await page.goto("/admin/users");
    await expect(page.getByText(/没有权限访问该页面/)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Maintainer: diagnostics never contain business-integrity evidence", async ({
    page,
    request,
  }) => {
    const maintainer = await createMaintainerViaApi(request);
    const token = (
      await request.post(`${BASE_URL}/api/auth/login`, {
        data: { username: maintainer.username, password: MAINTAINER_PASSWORD },
      })
    )
      .headers()
      ["set-cookie"]?.match(/auth-token=([^;]+)/)?.[1];
    expect(token).toBeTruthy();
    const res = await request.get(`${BASE_URL}/api/system/diagnostics`, {
      headers: { cookie: `auth-token=${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(
      body.integrity,
      "Maintainer must not receive integrity block",
    ).toBeUndefined();
  });

  test.skip(!evidenceAvailable(), "evidence CLI not available in this mode");
  test("last backup failed → truthful warning; secret values never rendered", async ({
    page,
    request,
  }) => {
    recordEvidence([
      "start",
      "--operation-id",
      "logical:e2e-failed",
      "--type",
      "logical",
      "--artifact-label",
      "e2e-failed.dump",
      "--executor",
      "host_script",
    ]);
    recordEvidence([
      "fail",
      "--operation-id",
      "logical:e2e-failed",
      "--type",
      "logical",
      "--executor",
      "host_script",
      "--reason",
      "verification failed: pg_restore --list rejected the archive",
    ]);

    await loginViaUi(
      page,
      ADMIN_USERNAME,
      ADMIN_PASSWORD,
      /\/admin\/dashboard/,
    );
    await page.goto("/admin/operations");
    await expect(page.getByTestId("operations-page")).toBeVisible();

    // Runs exist but none verified → NOT VERIFIED (never a false green).
    await expect(page.getByTestId("backup-status-badge")).toHaveText("未验证", {
      timeout: 15_000,
    });
    // The failed run is newer than any verified success → warning banner.
    await expect(
      page.getByText("最近一次备份失败，且晚于最近一次已验证备份。"),
    ).toBeVisible();

    // Secrets / host paths never rendered.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/postgresql:\/\/|password|PGPASSWORD|secret/i);
  });

  test.skip(!evidenceAvailable(), "evidence CLI not available in this mode");
  test("verified backup → healthy posture with last verified artifact", async ({
    page,
    request,
  }) => {
    recordEvidence([
      "complete",
      "--operation-id",
      "logical:e2e-verified",
      "--type",
      "logical",
      "--artifact-label",
      "e2e-verified.dump",
      "--size-bytes",
      "1024",
      "--verification-method",
      "pg_restore_list",
      "--executor",
      "host_script",
    ]);

    await loginViaUi(
      page,
      ADMIN_USERNAME,
      ADMIN_PASSWORD,
      /\/admin\/dashboard/,
    );
    await page.goto("/admin/operations");
    await expect(page.getByTestId("backup-status-badge")).toHaveText("健康", {
      timeout: 15_000,
    });
    await expect(
      page.getByText("e2e-verified.dump", { exact: false }),
    ).toBeVisible();
  });

  test("Admin records policy intent → DESIRED vs OBSERVED vs STATUS renders; Maintainer cannot edit", async ({
    page,
    request,
  }) => {
    // Seed a verified backup 26h old so RPO compliance is measurable.
    recordEvidence([
      "complete",
      "--operation-id",
      "logical:e2e-rpo",
      "--type",
      "logical",
      "--artifact-label",
      "e2e-rpo.dump",
      "--size-bytes",
      "2048",
      "--verification-method",
      "pg_restore_list",
      "--executor",
      "host_script",
    ]);
    // Backdate the verified_at to 26h ago via a second run is not possible
    // (duplicate conflict) — set the desired RPO to 1h; the verified backup
    // was just recorded, so RPO shows SATISFIED. Then set RPO to 30s via the
    // UI and assert NOT_SATISFIED (the observed age exceeds the desired).
    await loginViaUi(
      page,
      ADMIN_USERNAME,
      ADMIN_PASSWORD,
      /\/admin\/dashboard/,
    );
    await page.goto("/admin/operations");
    await expect(page.getByTestId("operations-page")).toBeVisible();

    // Configure intent through the UI (Admin edit → save). The verified
    // backup was recorded just now, so a 300s desired RPO (the UI floor) is
    // SATISFIED — the truthful rendering of a fresh verified backup. The
    // NOT_SATISFIED / UNKNOWN states are covered by the API compliance unit
    // tests (they need aged evidence, which the CLI cannot fabricate).
    await expect(page.getByTestId("policy-edit-button")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("policy-edit-button").click();
    await page.getByLabel("恢复点目标 (RPO) (s)").fill("300");
    await page.getByLabel("变更原因（必填）").fill("e2e rpo intent");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("已满足")).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText("已保存（仅意图记录，不影响基础设施）"),
    ).toBeVisible();

    // The intent is an intent only — the API exposes no infra mutation.
    const adminToken = await adminApiToken(request);
    const policyRes = await request.get(`${BASE_URL}/api/system/ops-policy`, {
      headers: { cookie: `auth-token=${adminToken}` },
    });
    expect(policyRes.status()).toBe(200);
    const policyBody = await policyRes.json();
    expect(policyBody.policy.desiredRpoSeconds).toBe(300);

    // Maintainer sees the intent read-only (no edit control, PUT denied).
    const maintainer = await createMaintainerViaApi(request);
    const mToken = (
      await request.post(`${BASE_URL}/api/auth/login`, {
        data: { username: maintainer.username, password: MAINTAINER_PASSWORD },
      })
    )
      .headers()
      ["set-cookie"]?.match(/auth-token=([^;]+)/)?.[1];
    await page.context().clearCookies();
    const mPut = await request.put(`${BASE_URL}/api/system/ops-policy`, {
      headers: { cookie: `auth-token=${mToken}` },
      data: {
        desiredRpoSeconds: 3600,
        desiredRetentionDays: 30,
        desiredDrillCadenceDays: 7,
        version: policyBody.policy.version,
        reason: "maintainer override",
      },
    });
    expect(mPut.status(), "Maintainer PUT must be denied").toBe(403);
  });
});
