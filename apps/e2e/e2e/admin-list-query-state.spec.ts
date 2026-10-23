import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { loginAsAdmin } from "../lib/login";
import { adminApiToken, adminPost, adminGet } from "../lib/flow";

/**
 * #784 stage A3 — L3 witnesses for the URL-as-authority contract on the two
 * admin lists.
 *
 * Scenario source: docs/design/admin-list-query-state-bdd.md.
 * Covered here: A04 (list → detail → Back restores the query), A05 (the
 * internal return restores the query, survives a detail reload, and refuses a
 * hostile carried target), A06 (Back leaves a parameter behind and the next
 * write must not revive it), A13 (a cross-identity pending does not collapse
 * the page geometry) and A15 (filter replaces, paging pushes, the internal
 * return pushes).
 *
 * Determinism contract: every seeded record carries a per-run unique stamp, so
 * assertions never depend on baseline data (the exam_e2e database is
 * persistent). Every step is event-synced on the list response it depends on —
 * no sleeps, no fixed page caps, no assumed global page position. The one
 * exception is the A04 Back restoration in step ⑤, whose oracle is the
 * restored state itself: a Back that lands before the editor route rendered
 * legitimately issues no list GET at all (OBS-2026-10-23-002).
 *
 * A04/A05/A06/A13/A15 must leave inspectable evidence, so this file forces
 * traces on (the global setting is `retain-on-failure`) and attaches an
 * explicit PASS artifact per witness. Artifacts carry only fixture data — no
 * candidate credentials, no tokens.
 */

test.use({ trace: "on" });

const STAMP = Date.now().toString(36);
/** Matches the 21 seeded questions by content alone. */
const KEYWORD = `a3kw${STAMP}`;
/** The published set must span at least three pages (A15 step ④). */
const PUBLISHED_EXAMS = Array.from(
  { length: 41 },
  (_, i) => `A3Q${STAMP} 考试 ${String(i + 1).padStart(2, "0")}`,
);
/** Enough matching questions to make the keyword query span two pages. */
const KEYWORD_QUESTIONS = 21;
/** The list requests carry the page size in their query, which is what keeps
 * the item endpoints (`/api/questions/:id`) out of the tracked set. */
const QUESTIONS_LIST = "/api/questions?page=";
const EXAMS_LIST = "/api/exams?page=";

type ListRequest = { url: string; status: number };

/**
 * Records every list request the page issues, so an assertion can bind the URL
 * to the query that was actually sent rather than only to what was rendered.
 */
function trackListRequests(page: Page, pathFragment: string): ListRequest[] {
  const seen: ListRequest[] = [];
  page.on("response", (res) => {
    if (res.request().method() !== "GET") return;
    if (!res.url().includes(pathFragment)) return;
    seen.push({ url: res.url(), status: res.status() });
  });
  return seen;
}

/** Waits for the next list response and returns its URL. */
async function nextListResponse(
  page: Page,
  pathFragment: string,
): Promise<string> {
  const res = await page.waitForResponse(
    (r) => r.request().method() === "GET" && r.url().includes(pathFragment),
  );
  return res.url();
}

test.describe.serial("admin list URL query state (#784 A3 BDD L3)", () => {
  let adminToken: string;
  let courseId: string;
  let questionId: string;

  test("seed a keyword course, 21 keyword questions and 41 published exams", async ({
    request,
  }) => {
    test.setTimeout(180_000);
    adminToken = await adminApiToken(request);

    // Premise check on the contract this spec walks: the published set must
    // span ≥3 pages BEFORE any UI is involved, so the walk's page 3 is real.
    const premise = await adminGet(
      request,
      adminToken,
      "/api/exams?page=1&pageSize=20&statuses=published",
    );
    expect(premise.ok(), await premise.text()).toBe(true);

    const course = await adminPost(request, adminToken, "/api/courses", {
      name: `A3Q 课程 ${STAMP}`,
      code: `A3Q-${STAMP}`,
      description: "",
    });
    expect(course.ok(), await course.text()).toBe(true);
    courseId = ((await course.json()) as { id: string }).id;

    // One shared question doubles as every exam's only item, so the fixture
    // cost stays linear in exams rather than in (exam × question).
    const first = await adminPost(request, adminToken, "/api/questions", {
      courseId,
      type: "true_false",
      content: `${KEYWORD} 题目 01`,
      standardAnswer: true,
      score: 10,
      difficulty: 2,
    });
    expect(first.ok(), await first.text()).toBe(true);
    questionId = ((await first.json()) as { id: string }).id;

    for (let i = 2; i <= KEYWORD_QUESTIONS; i += 1) {
      const res = await adminPost(request, adminToken, "/api/questions", {
        courseId,
        type: "true_false",
        content: `${KEYWORD} 题目 ${String(i).padStart(2, "0")}`,
        standardAnswer: true,
        score: 10,
        difficulty: 2,
      });
      expect(res.ok(), await res.text()).toBe(true);
    }

    for (const title of PUBLISHED_EXAMS) {
      const exam = await adminPost(request, adminToken, "/api/exams", {
        title,
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3_600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 6,
        totalScore: 10,
        questionIds: [questionId],
      });
      expect(exam.ok(), await exam.text()).toBe(true);
      const id = ((await exam.json()) as { id: string }).id;
      const publish = await adminPost(
        request,
        adminToken,
        `/api/exams/${id}/publish`,
      );
      expect(publish.ok(), await publish.text()).toBe(true);
    }

    const after = await adminGet(
      request,
      adminToken,
      "/api/exams?page=1&pageSize=20&statuses=published",
    );
    const body = (await after.json()) as { totalPages: number };
    expect(
      body.totalPages,
      "A15 step ④ needs a published set spanning ≥3 pages",
    ).toBeGreaterThanOrEqual(3);
  });

  test("A15: filter replaces, paging pushes, and the internal return pushes back", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const lists = trackListRequests(page, EXAMS_LIST);

    // A real prior entry, so the last Back can be observed LEAVING the list.
    await page.goto("/admin/dashboard");
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await page.goto("/admin/exams");
    await expect(page.getByRole("table")).toBeVisible();

    // ① filter commit — a REPLACE: no bare `/admin/exams` entry may survive it.
    const filterUrl = new URL(
      await (async () => {
        const pending = nextListResponse(page, EXAMS_LIST);
        await page.getByRole("combobox", { name: "按状态筛选" }).click();
        await page.getByRole("option", { name: "已发布" }).click();
        return pending;
      })(),
    );
    expect(filterUrl.searchParams.get("statuses")).toBe("published");
    expect(filterUrl.searchParams.get("page")).toBe("1");
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/admin/exams" &&
        url.searchParams.get("status") === "published",
    );

    // ②③ paging — PUSH: two more history entries, each naming its page.
    for (const pageNumber of [2, 3]) {
      const turnUrl = new URL(
        await (async () => {
          const pending = nextListResponse(page, EXAMS_LIST);
          await page.getByRole("button", { name: "下一页" }).click();
          return pending;
        })(),
      );
      expect(turnUrl.searchParams.get("page")).toBe(String(pageNumber));
      expect(turnUrl.searchParams.get("statuses")).toBe("published");
      const expectedPage = String(pageNumber);
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === "/admin/exams" &&
          url.searchParams.get("status") === "published" &&
          url.searchParams.get("page") === expectedPage,
      );
    }

    // ④ enter the detail from a row on page 3 — PUSH, carrying the list URL.
    await page
      .getByRole("table")
      .getByRole("button", { name: "查看详情" })
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/exams\/[^/]+$/);
    const detailPath = new URL(page.url()).pathname;

    // ⑤ the internal return — PUSH back to the full query URL.
    const returnUrl = new URL(
      await (async () => {
        const pending = nextListResponse(page, EXAMS_LIST);
        await page.getByRole("button", { name: "返回列表" }).click();
        return pending;
      })(),
    );
    expect(returnUrl.searchParams.get("statuses")).toBe("published");
    expect(returnUrl.searchParams.get("page")).toBe("3");
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/admin/exams" &&
        url.searchParams.get("status") === "published" &&
        url.searchParams.get("page") === "3",
    );
    // The status control and the footer agree with the URL, not with a
    // remembered value.
    await expect(page.getByRole("combobox", { name: "按状态筛选" })).toHaveText(
      "已发布",
    );
    await expect(page.getByText(/显示 41-/)).toBeVisible();

    // Walk back through the entries the app created. Back1=detail kills a
    // REPLACE internal return; Back2/Back3 kill REPLACE paging; Back4 must be
    // the filtered entry, so a PUSH filter commit (which would leave a bare
    // `/admin/exams` entry here) is rejected; Back5 leaves the list.
    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === detailPath);
    await page.goBack();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/admin/exams" &&
        url.searchParams.get("status") === "published" &&
        url.searchParams.get("page") === "3",
    );
    await expect(page.getByText(/显示 41-/)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/admin/exams" &&
        url.searchParams.get("status") === "published" &&
        url.searchParams.get("page") === "2",
    );
    await expect(page.getByText(/显示 21-/)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/admin/exams" &&
        url.searchParams.get("status") === "published" &&
        url.searchParams.get("page") === null,
    );
    await expect(page.getByText(/显示 1-/)).toBeVisible();
    await page.goBack();
    await expect(page).not.toHaveURL((url) => url.pathname === "/admin/exams");

    // Every list request this walk issued answered successfully.
    for (const req of lists) expect(req.status, req.url).toBe(200);
    await test.info().attach("A15-history-walk.txt", {
      body: [
        "PASS A15",
        `filter commit   -> ${filterUrl.pathname}${filterUrl.search}`,
        "page turn 2     -> push",
        "page turn 3     -> push",
        `detail          -> ${detailPath}`,
        `internal return -> ${returnUrl.pathname}${returnUrl.search}`,
        "Back1=detail Back2=page3 Back3=page2 Back4=filtered Back5=left list",
        "no bare /admin/exams entry was observed in the walk",
        `list requests observed: ${lists.length}`,
      ].join("\n"),
      contentType: "text/plain",
    });
    await test.info().attach("A15-final.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test("A04/A06: Back restores the query, and the next write does not revive what Back left", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const lists = trackListRequests(page, QUESTIONS_LIST);

    // ① a deep entry, so the keyword is already the committed query.
    await page.goto(`/admin/questions?search=${KEYWORD}`);
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText(/共 21 条/)).toBeVisible();

    // ② paging — PUSH, so Back has somewhere to go.
    const turnUrl = new URL(
      await (async () => {
        const pending = nextListResponse(page, QUESTIONS_LIST);
        await page.getByRole("button", { name: "下一页" }).click();
        return pending;
      })(),
    );
    expect(turnUrl.searchParams.get("search")).toBe(KEYWORD);
    expect(turnUrl.searchParams.get("page")).toBe("2");
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/admin/questions" &&
        url.searchParams.get("search") === KEYWORD &&
        url.searchParams.get("page") === "2",
    );
    await expect(page.getByText(/显示 21-/)).toBeVisible();

    // ③ Back leaves `page` behind: URL, control and rows must all describe
    //    page 1 again (A06).
    await page.goBack();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/admin/questions" &&
        url.searchParams.get("search") === KEYWORD &&
        url.searchParams.get("page") === null,
    );
    await expect(page.getByLabel("搜索题目")).toHaveValue(KEYWORD);
    await expect(page.getByText(/显示 1-/)).toBeVisible();

    // ④ a NEW filter commit after Back. If the write were based on a stale
    //    parameter set (the one that still had `page=2`) it would resurrect the
    //    page the user just left; if the control did not follow the URL the
    //    search box would be empty and the commit would drop the keyword.
    //    The waiter binds to the commit's own request identity
    //    (search + difficulty), not to "the next list response": the Back of
    //    step ③ fires a list GET for the restored query, and under compressed
    //    timing that response can still be in flight when this waiter arms
    //    (OBS-2026-10-23-002, step-④ variant).
    const commitUrl = new URL(
      (
        await (async () => {
          const pending = page.waitForResponse(
            (r) =>
              r.request().method() === "GET" &&
              r.url().includes(QUESTIONS_LIST) &&
              r.url().includes(`search=${KEYWORD}`) &&
              r.url().includes("difficulty=2"),
          );
          await page.getByRole("combobox", { name: "按难度筛选" }).click();
          await page.getByRole("option", { name: "难度 2" }).click();
          return pending;
        })()
      ).url(),
    );
    expect(commitUrl.searchParams.get("search")).toBe(KEYWORD);
    expect(commitUrl.searchParams.get("difficulty")).toBe("2");
    expect(commitUrl.searchParams.get("page")).toBe("1");
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/admin/questions" &&
        url.searchParams.get("search") === KEYWORD &&
        url.searchParams.get("difficulty") === "2" &&
        url.searchParams.get("page") === null,
    );
    await expect(page.getByLabel("搜索题目")).toHaveValue(KEYWORD);
    await expect(page.getByText(/共 21 条/)).toBeVisible();

    // ⑤ A04: entering a row's editor is a PUSH, so Back returns to the query the
    //    user was on — URL, control and rows all describe it again. The oracle
    //    is the restored STATE, not a fresh list GET: whether the restoration
    //    replays the request is an implementation detail. When the popstate
    //    lands before the editor route has rendered (React batches the push
    //    and the pop into one render that reuses the mounted list instance),
    //    the list never unmounts, no request fires, and every user-visible
    //    fact is still correct — waiting for a list GET here times out against
    //    CORRECT behaviour (OBS-2026-10-23-002). What this witness proves is
    //    the settled state of the committed query within ONE fixture
    //    identity: the restored controls (search text and the difficulty
    //    trigger), the total, the page range and the fixture row must all
    //    reappear. It cannot discriminate a body rendered from a different
    //    filter identity — this fixture draws identical rows across adjacent
    //    identities — so cross-identity rowset contracts stay with the L2
    //    queryState suite (A08/A09/A16), not here.
    await page
      .getByRole("table")
      .getByRole("button", { name: "编辑题目" })
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/questions\/[^/]+\/edit$/);
    const editorPath = new URL(page.url()).pathname;
    await page.goBack();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/admin/questions" &&
        url.searchParams.get("search") === KEYWORD &&
        url.searchParams.get("difficulty") === "2" &&
        url.searchParams.get("page") === null,
    );
    await expect(page.getByLabel("搜索题目")).toHaveValue(KEYWORD);
    await expect(
      page.getByRole("combobox", { name: "按难度筛选" }),
    ).toContainText("难度 2");
    await expect(page.getByText(/共 21 条/)).toBeVisible();
    await expect(page.getByText(/显示 1-20 条/)).toBeVisible();
    await expect(
      page.getByRole("table").getByText(`${KEYWORD} 题目 01`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "上一页" })).toBeDisabled();

    // ⑥ Back from the committed state LEAVES the list. A filter commit is a
    //    history REPLACEMENT, so the query the user committed over is not an
    //    entry they can return to; a push-on-commit implementation would leave
    //    one behind and this Back would land on it (a /admin/questions URL).
    //    The editor entry is FORWARD history after ⑤'s Back, so the only
    //    discriminative claim here is that the list is gone.
    await page.goBack();
    await expect(page).not.toHaveURL(
      (url) => url.pathname === "/admin/questions",
    );

    for (const req of lists) expect(req.status, req.url).toBe(200);
    await test.info().attach("A04-A06-back-and-write.txt", {
      body: [
        "PASS A04/A06",
        `page-turn request -> page=${turnUrl.searchParams.get("page")} search=${turnUrl.searchParams.get("search")}`,
        "Back restored URL = control value = footer range (page 1)",
        `post-Back commit  -> search=${commitUrl.searchParams.get("search")} difficulty=${commitUrl.searchParams.get("difficulty")} page=${commitUrl.searchParams.get("page")}`,
        `editor entry      -> ${editorPath} (push)`,
        "Back from editor  -> URL = control = footer = fixture rows (page 1, difficulty 2)",
        "restoration verified by the restored state, not by a replayed GET",
        "no page=2 revived after Back; the keyword survived the commit",
        "Back from the committed query left the list (commit replaced its entry)",
      ].join("\n"),
      contentType: "text/plain",
    });
    await test.info().attach("A04-A06-final.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test("A05: internal return restores the query, survives a reload, and refuses a hostile target", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    // (i) a header entry point (新建题目) → cancel returns to the query URL.
    await page.goto(`/admin/questions?search=${KEYWORD}&page=2`);
    await expect(page.getByRole("table")).toBeVisible();
    await page.getByRole("button", { name: "新增题目" }).click();
    await expect(page).toHaveURL(/\/admin\/questions\/new$/);
    const cancelUrl = new URL(
      await (async () => {
        const pending = nextListResponse(page, QUESTIONS_LIST);
        await page.getByRole("button", { name: "取消" }).click();
        return pending;
      })(),
    );
    expect(cancelUrl.searchParams.get("search")).toBe(KEYWORD);
    expect(cancelUrl.searchParams.get("page")).toBe("2");
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/admin/questions" &&
        url.searchParams.get("search") === KEYWORD &&
        url.searchParams.get("page") === "2",
    );

    // (ii) a row entry point → the detail reloaded in place. react-router keeps
    //      the carried target in `history.state`, and a same-entry reload must
    //      preserve it → the internal return still restores the query.
    await page
      .getByRole("table")
      .getByRole("button", { name: "编辑题目" })
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/questions\/[^/]+\/edit$/);
    await page.reload();
    await expect(page.getByRole("button", { name: "取消" })).toBeVisible();
    const reloadUrl = new URL(
      await (async () => {
        const pending = nextListResponse(page, QUESTIONS_LIST);
        await page.getByRole("button", { name: "取消" }).click();
        return pending;
      })(),
    );
    expect(reloadUrl.searchParams.get("search")).toBe(KEYWORD);
    expect(reloadUrl.searchParams.get("page")).toBe("2");
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/admin/questions" &&
        url.searchParams.get("search") === KEYWORD &&
        url.searchParams.get("page") === "2",
    );

    // (iii) a hostile carried target. The history entry is rewritten before the
    //       reload, which is how a real browser can be made to carry one, so
    //       the app boots with `from` pointing outside this list. The exit must
    //       land on the bare list of THIS page, on the app's own origin.
    const origin = new URL(page.url()).origin;
    const hostileTargets = [
      "//evil.example/admin/questions",
      "/\\evil.example",
      "/admin/exams?status=published",
      "/admin/questions/../exams",
    ];
    for (const hostile of hostileTargets) {
      await page
        .getByRole("table")
        .getByRole("button", { name: "编辑题目" })
        .first()
        .click();
      await expect(page).toHaveURL(/\/admin\/questions\/[^/]+\/edit$/);
      await page.evaluate((from) => {
        const state = window.history.state as Record<string, unknown>;
        window.history.replaceState({ ...state, usr: { from } }, "");
      }, hostile);
      await page.reload();
      await expect(page.getByRole("button", { name: "取消" })).toBeVisible();
      await page.getByRole("button", { name: "取消" }).click();
      await expect(page).toHaveURL(`${origin}/admin/questions`);
      expect(new URL(page.url()).origin).toBe(origin);
      // Back to the query list for the next hostile value.
      await page.goto(`/admin/questions?search=${KEYWORD}&page=2`);
      await expect(page.getByRole("table")).toBeVisible();
    }

    await test.info().attach("A05-internal-return.txt", {
      body: [
        "PASS A05",
        `(i)   header entry  -> search=${cancelUrl.searchParams.get("search")} page=${cancelUrl.searchParams.get("page")}`,
        `(ii)  after reload  -> search=${reloadUrl.searchParams.get("search")} page=${reloadUrl.searchParams.get("page")}`,
        `(iii) hostile targets -> ${origin}/admin/questions for all ${hostileTargets.length}`,
        hostileTargets.join("\n"),
      ].join("\n"),
      contentType: "text/plain",
    });
    await test.info().attach("A05-final.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test("A13: a cross-identity pending does not collapse the page geometry", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/questions?search=${KEYWORD}`);
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText(/显示 1-/)).toBeVisible();

    const pre = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      rowHeight:
        document.querySelector("tbody tr")?.getBoundingClientRect().height ?? 0,
    }));
    expect(pre.rowHeight, "the fixture must render real rows").toBeGreaterThan(
      0,
    );

    // A controlled gate, not a sleep: the list response is held until this test
    // releases it, which is the only deterministic way to observe the pending
    // window against a real API.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    let handlerDone: Promise<void> = Promise.resolve();
    const listRoute = /\/api\/questions\?/;
    await page.route(listRoute, (route) => {
      const run = async () => {
        if (!held) {
          held = true;
          await gate;
        }
        await route.continue();
      };
      handlerDone = run();
      return handlerDone;
    });

    // Cross-identity change: clearing the search moves the identity.
    const pendingRequest = page.waitForRequest(
      (r) => r.method() === "GET" && listRoute.test(r.url()),
    );
    await page.getByRole("button", { name: "清除搜索" }).click();
    await pendingRequest;

    // The pending window must not show the old identity's rows and must not
    // show an empty state — while the list region keeps its height.
    await expect(
      page.getByRole("table").getByText(`${KEYWORD} 题目 01`, { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("未找到匹配的题目")).toHaveCount(0);
    await expect(page.getByText("暂无题目")).toHaveCount(0);

    const post = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    }));

    const collapsedTo = pre.scrollHeight - pre.rowHeight;
    await test.info().attach("A13-pending-geometry.txt", {
      body: [
        `preScrollHeight  = ${pre.scrollHeight}`,
        `innerHeight      = ${pre.innerHeight}`,
        `rowHeight        = ${pre.rowHeight}`,
        `postScrollHeight = ${post.scrollHeight}`,
        "",
        "DISCRIMINATING criterion — the list region must not collapse:",
        `  post >= pre - rowHeight : ${post.scrollHeight} >= ${collapsedTo}`,
        "",
        "Floor (recorded, NOT discriminating): `scrollHeight >= innerHeight`",
        `  ${post.scrollHeight} >= ${pre.innerHeight}`,
        "  the document element's scrollHeight is floored at the viewport and",
        "  AdminLayout adds min-h-screen, so this can never fail; the collapse",
        "  it is meant to catch shows up in the criterion above.",
      ].join("\n"),
      contentType: "text/plain",
    });
    await test.info().attach("A13-pending.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    expect(post.scrollHeight).toBeGreaterThanOrEqual(collapsedTo);

    // Release the held request, then let its handler finish before the route is
    // unregistered — unrouting a route whose handler is still awaiting would
    // make `route.continue()` throw instead of letting the request through.
    release();
    await handlerDone;
    await page.unroute(listRoute);

    // The pending window ends in the real result, not in a stuck loader.
    await expect(page.getByText(/共 \d+ 条/)).toBeVisible();
    await expect(page.getByText("暂无题目")).toHaveCount(0);
  });
});
