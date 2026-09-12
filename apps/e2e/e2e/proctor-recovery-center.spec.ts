/**
 * EXAM-303 / J6 — Proctor Recovery Center browser acceptance.
 *
 * The #303 acceptance criterion "Representative browser E2E covers allowed and
 * denied paths" is satisfied HERE: this spec drives the real product surface
 * (sidebar → worklist → incident detail → canonical command) against the real
 * API, for an ASSIGNED and an UNASSIGNED Proctor.
 *
 * Scope is deliberately bounded — the six-action investigate family is covered
 * by the API/component tests; the browser proves the two things only a browser
 * can prove: the surface is actually reachable by a Proctor with exactly the
 * Proctor preset, and one allowed mutation converges through the real command
 * + refresh cycle while Admin terminal authority stays invisible.
 *
 * Denied path = ADR-015 anti-enumeration: an unassigned Proctor must not
 * obtain incident truth through the UI (empty collection, generic detail
 * failure state), and the request path must not reveal whether the incident
 * exists at all.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";
import { loginViaUi } from "../lib/login";
import { createProctorAssignmentFixture, seedExam } from "../lib/seed";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/** Pure Proctor persona — the Proctor preset only (see proctor-landing.spec.ts). */
const PROCTOR_LANDING = /\/admin\/proctor(?:$|[/?#])/;

interface ProctorCredentials {
  userId: string;
  username: string;
  password: string;
}

function uniqueRunId(): string {
  // Short on purpose: `seedExam` derives the course code as
  // `E2E-<unique>-<timestamp>`, and the course-code column is capped at 50.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function createProctorUser(
  request: APIRequestContext,
  adminToken: string,
  suffix: "a" | "u",
): Promise<ProctorCredentials> {
  // Username is capped at 50 chars: keep prefix + suffix + base36 stamp short.
  const stamp = Date.now().toString(36);
  const username = `e2e-rec-proctor-${suffix}-${stamp}`;
  const password = "proctor123";
  const res = await request.post(`${BASE_URL}/api/users`, {
    headers: { Cookie: `auth-token=${adminToken}` },
    data: {
      username,
      password,
      name: `E2E Recovery Proctor ${suffix} ${stamp}`,
      role: "Proctor",
    },
  });
  expect(res.status(), `POST /api/users → ${await res.text()}`).toBe(201);
  const body = (await res.json()) as { id: string };
  return { userId: body.id, username, password };
}

async function createIncident(
  request: APIRequestContext,
  adminToken: string,
  examId: string,
  description: string,
): Promise<string> {
  const res = await request.post(
    `${BASE_URL}/api/admin/exams/${examId}/incidents`,
    {
      headers: { Cookie: `auth-token=${adminToken}` },
      data: {
        operationId: crypto.randomUUID(),
        type: "network_interruption",
        severity: "major",
        description,
      },
    },
  );
  expect(res.ok(), `createIncident → ${res.status()} ${await res.text()}`).toBe(
    true,
  );
  return ((await res.json()) as { incident: { id: string } }).incident.id;
}

test.describe("Proctor Recovery Center (#303)", () => {
  test.describe.configure({ mode: "serial" });

  let adminToken: string;
  let examId: string;
  let examTitle: string;
  let incidentId: string;
  let incidentDescription: string;
  let assigned: ProctorCredentials;
  let unassigned: ProctorCredentials;

  test.beforeAll(async ({ request }) => {
    const unique = uniqueRunId();
    const seeded = await seedExam(request, `proctor-recovery-${unique}`);
    examId = seeded.examId;
    examTitle = seeded.examTitle;
    adminToken = await adminApiToken(request);

    // The candidate starts a live attempt through the canonical candidate path
    // so the exam carries real runtime state; the incident is created
    // exam-wide (not anchored to that attempt), which is also what makes the
    // membership-only `link_attempt` action available to the Proctor.
    const candidateToken = await candidateLoginApi(
      request,
      seeded.candidate.username,
      seeded.candidate.password,
    );
    await candidateStartAttempt(request, candidateToken, examId);

    incidentDescription = `E2E 监考恢复事件 ${unique}`;
    incidentId = await createIncident(
      request,
      adminToken,
      examId,
      incidentDescription,
    );

    assigned = await createProctorUser(request, adminToken, "a");
    await createProctorAssignmentFixture(
      request,
      adminToken,
      examId,
      assigned.userId,
    );
    // Deliberately NOT assigned to this exam.
    unassigned = await createProctorUser(request, adminToken, "u");
  });

  test("allowed path: assigned Proctor reaches the worklist, opens the incident, and adds a note", async ({
    page,
  }) => {
    await loginViaUi(
      page,
      assigned.username,
      assigned.password,
      PROCTOR_LANDING,
    );

    // ── Reachability through the real product surface ──
    // Nav label (nav.items.proctorRecovery) is the short form; the page title
    // is "监考恢复中心".
    const navLink = page
      .getByTestId("app-sidebar")
      .getByRole("link", { name: "监考恢复" });
    await expect(navLink).toBeVisible({ timeout: 15_000 });
    await navLink.click();
    await page.waitForURL("**/admin/proctor/recovery", { timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "监考恢复中心" }),
    ).toBeVisible({ timeout: 15_000 });

    // The assigned incident is discoverable in the worklist. The worklist
    // projects incident status (a link to the detail route) plus the exam
    // title — NOT the free-text description, which belongs to the detail
    // surface. The title renders twice by design (responsive table + card
    // list), so assert the count rather than a single match.
    await expect(page.getByText(examTitle)).toHaveCount(2, { timeout: 15_000 });
    await expect(
      page
        .locator(`a[href="/admin/proctor/recovery/incidents/${incidentId}"]`)
        .first(),
    ).toBeVisible();

    // ── Open the detail surface ──
    await page.goto(`/admin/proctor/recovery/incidents/${incidentId}`);
    // The description renders in the page header AND in the incident_created
    // event payload, so assert the first visible match.
    await expect(page.getByText(incidentDescription).first()).toBeVisible({
      timeout: 15_000,
    });

    // ── One allowed mutation through the canonical command route ──
    await expect(page.getByRole("button", { name: "添加备注" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "添加备注" }).click();
    const noteBody = `E2E 监考备注 ${uniqueRunId()}`;
    await page.getByRole("dialog").getByLabel("备注内容").fill(noteBody);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "添加备注" })
      .click();
    await expect(page.getByText("已添加备注").first()).toBeVisible({
      timeout: 15_000,
    });

    // Refreshed detail shows the note — the server snapshot is the authority.
    // The body renders in the notes list AND inside the note_added event
    // payload, so match the notes-list entry exactly.
    await expect(page.getByText(noteBody, { exact: true }).first()).toBeVisible(
      { timeout: 15_000 },
    );

    // ── Full Proctor action surface is present (the reviewed B3 gap) ──
    for (const name of [
      "开始调查",
      "修改严重程度",
      "关联操作记录",
      "关联中断证据",
    ]) {
      await expect(
        page.getByRole("button", { name }),
        `action surface missing: ${name}`,
      ).toBeVisible();
    }
  });

  test("authority boundary: no Admin terminal/high-risk action is exposed to the Proctor", async ({
    page,
  }) => {
    await loginViaUi(
      page,
      assigned.username,
      assigned.password,
      PROCTOR_LANDING,
    );
    await page.goto(`/admin/proctor/recovery/incidents/${incidentId}`);
    await expect(page.getByText(incidentDescription).first()).toBeVisible({
      timeout: 15_000,
    });

    // Terminal incident judgment stays Admin-only (ADR-014 §8 / ADR-015 §13).
    for (const name of ["解决事件", "驳回事件"]) {
      await expect(
        page.getByRole("button", { name }),
        `Admin terminal action must not appear: ${name}`,
      ).toHaveCount(0);
    }
    // Terminal attempt commands were REMOVED from the Proctor preset.
    for (const name of ["强制交卷", "延长答题时间", "标记违规"]) {
      await expect(
        page.getByRole("button", { name }),
        `Admin attempt command must not appear: ${name}`,
      ).toHaveCount(0);
    }
  });

  test("denied path: unassigned Proctor gets no incident truth and no worklist row", async ({
    page,
    request,
  }) => {
    await loginViaUi(
      page,
      unassigned.username,
      unassigned.password,
      PROCTOR_LANDING,
    );

    // ── API boundary: uniform 404, never a "forbidden" that would confirm
    // the incident exists (ADR-015 anti-enumeration). The token comes from the
    // UI login above, so no second auth path is introduced. ──
    const cookies = await page.context().cookies();
    const token = cookies.find((c) => c.name === "auth-token")?.value ?? "";
    expect(token.length).toBeGreaterThan(0);
    const detailRes = await request.get(
      `${BASE_URL}/api/admin/incidents/${incidentId}/detail`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    expect(detailRes.status()).toBe(404);
    expect(
      ((await detailRes.json()) as { error: { code: string } }).error.code,
    ).toBe("RESOURCE_NOT_FOUND");

    // ── Worklist: the empty state, never someone else's row ──
    await page.goto("/admin/proctor/recovery");
    await page.waitForURL("**/admin/proctor/recovery", { timeout: 15_000 });
    await expect(page.getByText("暂无事件")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator(`a[href="/admin/proctor/recovery/incidents/${incidentId}"]`),
    ).toHaveCount(0);
    await expect(page.getByText(examTitle)).toHaveCount(0);

    // ── Detail: the page mounts and renders the 404 state, but never the
    // incident. The positive anchor (the alert) matters: absence-only
    // assertions would also pass against a blank/deleted page. ──
    await page.goto(`/admin/proctor/recovery/incidents/${incidentId}`);
    await expect(page.getByRole("alert")).toContainText("事件未找到", {
      timeout: 15_000,
    });
    await expect(page.getByText(incidentDescription)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "添加备注" })).toHaveCount(0);
    // The route stays put — no redirect that would imply the incident exists.
    expect(new URL(page.url()).pathname).toContain(
      `/admin/proctor/recovery/incidents/${incidentId}`,
    );
  });
});
