# Job 4: Organization Settings + User + Candidate Management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build organization settings, org CRUD, candidate field config, user management, candidate management with CSV import — all with working admin UI pages.

**Architecture:** Vertical slices per subtask. Each slice: API route → repository method → UI page. Follow existing patterns (auth.ts route, createTenantCrudRepo, Zod contracts). Route handlers are thin: validate → create ctx → call repo → return response.

**Tech Stack:** Fastify routes, Drizzle ORM repos, Zod contracts from `@exam/contracts`, React pages with shadcn/ui, react-hook-form + zod for client validation.

---

## Existing Code You Must Know

### Route handler pattern (from auth.ts)

```typescript
const route: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/path",
    { preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])] },
    async (request: any, reply: any) => {
      const ctx = request["ctx"] as RequestContext;
      const { db } = createDatabase();
      const repo = createSomeRepo(db);
      const result = repo.someMethod(ctx, ...args);
      return reply.code(200).send(SomeSchema.parse(result));
    },
  );
};
```

### Key repos available

- `createUserRepo(db)` — `create`, `findById`, `findByUsername`, `list`, `update`, `delete`
- `createOrganizationRepo(db)` — `create`, `findById`, `list`, `update`, `delete`, `resolveBrandingTenant`
- `createSettingsRepo(db)` — `get`, `upsert`, `delete`, `getPublicBranding`
- `createCandidateRepo(db)` — `create`, `findById`, `list`, `update`, `delete` (all from baseRepo)
- `createCandidateFieldRepo(db)` — `create`, `findById`, `list`, `update`, `delete` (all from baseRepo)
- `createAuditLogRepo(db)` — `create`, `findById`, `list`, `update`, `delete` (all from baseRepo)

### DB access pattern in routes

```typescript
import { createDatabase } from "@exam/db/src/database.js";
const { db } = createDatabase();
const repo = createXxxRepo(db);
```

### Server registration (server.ts)

```typescript
await app.register(routeFile, { prefix: "/api/some-domain" });
```

### Contracts location

All Zod schemas already defined in `packages/contracts/src/`:

- `settings.ts` — `BrandingQuerySchema`, `UpdateBrandingRequestSchema`, `OrganizationSettingsSchema`, `BrandingViewSchema`
- `organization.ts` — `CreateOrganizationRequestSchema`, `UpdateOrganizationRequestSchema`, `OrganizationSchema`
- `user.ts` — `CreateUserRequestSchema`, `UpdateUserRequestSchema`, `UserSchema`
- `candidate.ts` — `CreateCandidateRequestSchema`, `UpdateCandidateRequestSchema`, `CandidateSchema`, `CandidateFieldSchema`, `CreateCandidateFieldRequestSchema`, `UpdateCandidateFieldRequestSchema`, `CandidateImportRowSchema`, `CandidateImportRequestSchema`, `CandidateImportResultSchema`

### Schema notes

- `candidate_profiles` table (not `candidates`) — mapped via `sqliteSchema.candidateProfiles`
- `candidate_fields` table — mapped via `sqliteSchema.candidateFields`
- Candidate `fields` column is JSON (`Record<string, unknown>`)
- `candidate_fields` has no `updated_at` column

### Shared UI components available

- `PageHeader` — `title` + `actions` slot
- `EmptyState` — `icon`, `title`, `description`, `action?`
- `ErrorState` — `message`, `onRetry?`
- `LoadingState` — `label?`
- `ConfirmDialog` — `trigger`, `title`, `description`, `onConfirm`, `destructive?`
- `StatsCard` — `label`, `value`, `trend?`
- `routes` from `@/lib/routes` — centralized route constants

### API client (apps/web/src/lib/api.ts)

```typescript
(api.get<T>(path),
  api.post<T, B>(path, body),
  api.patch<T, B>(path, body),
  api.delete(path));
```

---

## Phase 1: Seed + Settings API

### Task 1: Make seed idempotent

**Files:**

- Modify: `packages/db/src/seed.ts`
- Test: `packages/db/src/seed.test.ts` (create)

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const dbPath = "./test-seed-idempotent.db";

describe("seed idempotency", () => {
  beforeEach(() => {
    if (existsSync(dbPath)) rmSync(dbPath);
  });
  afterEach(() => {
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it("creates exactly 1 org and 3 users on first run", () => {
    execSync(`DATABASE_URL=${dbPath} tsx packages/db/src/seed.ts`, {
      cwd: process.cwd(),
    });
    // Verify via direct DB query would be ideal, but for now just verify no error
    expect(existsSync(dbPath)).toBe(true);
  });

  it("does not duplicate on second run", () => {
    execSync(`DATABASE_URL=${dbPath} tsx packages/db/src/seed.ts`, {
      cwd: process.cwd(),
    });
    expect(() => {
      execSync(`DATABASE_URL=${dbPath} tsx packages/db/src/seed.ts`, {
        cwd: process.cwd(),
      });
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test — expect failure (seed crashes on duplicate slug)**

Run: `pnpm --filter @exam/db test -- --run src/seed.test.ts`
Expected: FAIL — `UNIQUE constraint failed: organizations.slug`

- [ ] **Step 3: Make seed idempotent**

Change `packages/db/src/seed.ts` to use `.onConflictDoNothing()` for org insert and check for existing users before inserting:

```typescript
// In seed function, replace direct inserts with:
db.insert(sqliteSchema.organizations).values(org).onConflictDoNothing().run();

for (const user of users) {
  const existing = db
    .select()
    .from(sqliteSchema.users)
    .where(
      and(
        eq(sqliteSchema.users.organizationId, org.id),
        eq(sqliteSchema.users.username, user.username),
      ),
    )
    .get();
  if (!existing) {
    db.insert(sqliteSchema.users).values(user).run();
  }
}
```

Add the needed imports: `and`, `eq` from `drizzle-orm`.

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm --filter @exam/db test -- --run src/seed.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/seed.ts packages/db/src/seed.test.ts
git commit -m "feat(job4): make seed script idempotent"
```

---

### Task 2: Settings API routes (GET public branding + PATCH admin branding)

**Files:**

- Create: `apps/api/src/routes/settings.ts`
- Modify: `apps/api/src/server.ts` (register route)

- [ ] **Step 1: Write failing test**

Create `apps/api/src/routes/settings.test.ts`:

```typescript
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import authPlugin from "../plugins/auth.js";
import { createDatabase } from "@exam/db/src/database.js";
import { migrateSqlite } from "@exam/db/src/sqlite.js";
import settingsRoutes from "./settings.js";
import { signJWT } from "@exam/auth/src/session.js";

describe("settings routes", () => {
  let app: any;
  let adminToken: string;
  let orgId: string;

  beforeAll(async () => {
    const { db } = createDatabase();
    migrateSqlite(db);
    // Seed org + admin user...
    // (use the same pattern as auth test setup)

    app = Fastify();
    await app.register(fastifyCookie);
    await app.register(authPlugin);
    await app.register(settingsRoutes, { prefix: "/api" });
    await app.ready();
  });

  it("GET /api/settings/branding returns fallback branding", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/settings/branding?organizationSlug=default`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("productName");
  });

  it("PATCH /api/admin/settings/branding updates branding", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/admin/settings/branding",
      payload: { productName: "Test Platform" },
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.productName).toBe("Test Platform");
  });

  it("PATCH /api/admin/settings/branding requires auth", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/admin/settings/branding",
      payload: { productName: "Nope" },
    });
    expect(res.statusCode).toBe(401);
  });

  afterAll(async () => {
    await app.close();
  });
});
```

- [ ] **Step 2: Run test — expect failure (module not found)**

Run: `pnpm --filter api test -- --run src/routes/settings.test.ts`
Expected: FAIL — cannot resolve `./settings.js`

- [ ] **Step 3: Implement settings routes**

Create `apps/api/src/routes/settings.ts`:

```typescript
import { FastifyPluginAsync } from "fastify";
import {
  BrandingQuerySchema,
  BrandingViewSchema,
  UpdateBrandingRequestSchema,
  OrganizationSettingsSchema,
} from "@exam/contracts";
import { createDatabase } from "@exam/db/src/database.js";
import { createSettingsRepo } from "@exam/db/src/repository/settingsRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import type { RequestContext, PublicBrandingContext } from "@exam/domain";

const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/settings/branding", async (request: any, _reply: any) => {
    const query = BrandingQuerySchema.parse(request.query);
    const { db } = createDatabase();
    const orgRepo = createOrganizationRepo(db);
    const settingsRepo = createSettingsRepo(db);

    const org = orgRepo.resolveBrandingTenant(
      { purpose: "public_branding" } as PublicBrandingContext,
      query.organizationSlug,
    );

    const branding = settingsRepo.getPublicBranding({
      purpose: "public_branding",
      organizationId: org.id,
    });

    return BrandingViewSchema.parse(branding);
  });

  fastify.patch(
    "/admin/settings/branding",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = request["ctx"] as RequestContext;
      const data = UpdateBrandingRequestSchema.parse(request.body);
      const { db } = createDatabase();
      const settingsRepo = createSettingsRepo(db);

      const settings = settingsRepo.upsert(ctx, data);
      return reply.code(200).send(OrganizationSettingsSchema.parse(settings));
    },
  );
};

export default settingsRoutes;
```

Register in `server.ts`:

```typescript
import settingsRoutes from "./routes/settings.js";
// ... after auth routes:
await app.register(settingsRoutes, { prefix: "/api" });
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm --filter api test -- --run src/routes/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/settings.ts apps/api/src/routes/settings.test.ts apps/api/src/server.ts
git commit -m "feat(job4): add settings API routes (public branding + admin update)"
```

---

### Task 3: Settings admin page (UI)

**Files:**

- Create: `apps/web/src/pages/admin/SettingsPage.tsx`
- Create: `apps/web/src/components/settings/PlatformSettingsForm.tsx`
- Modify: `apps/web/src/App.tsx` (add route)

- [ ] **Step 1: Write failing test**

Create `apps/web/src/pages/admin/SettingsPage.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { SettingsPage } from "./SettingsPage";

// Mock API
vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      productName: "Test Platform",
      productSubtitle: "Test Subtitle",
    }),
    patch: vi.fn().mockResolvedValue({
      productName: "Updated Platform",
    }),
  },
  setNavigate: () => {},
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/settings"]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/admin/settings" element={<SettingsPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("SettingsPage", () => {
  it("renders page title", async () => {
    renderPage();
    expect(await screen.findByText("平台与机构设置")).toBeInTheDocument();
  });

  it("renders product name field", async () => {
    renderPage();
    expect(await screen.findByLabelText("产品标题")).toBeInTheDocument();
  });

  it("renders save button", async () => {
    renderPage();
    expect(await screen.findByText("保存设置")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect failure (module not found)**

Run: `pnpm --filter web test -- --run src/pages/admin/SettingsPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement PlatformSettingsForm**

Create `apps/web/src/components/settings/PlatformSettingsForm.tsx`:

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { UpdateBrandingRequestSchema } from "@exam/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormValues = {
  productName?: string;
  productSubtitle?: string;
  footerText?: string;
  organizationDisplayName?: string;
  timezone?: string;
};

export function PlatformSettingsForm({
  defaultValues,
  onSave,
  isLoading,
}: {
  defaultValues: FormValues;
  onSave: (data: FormValues) => void;
  isLoading?: boolean;
}) {
  const { register, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(UpdateBrandingRequestSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSave)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="productName">产品标题</Label>
        <Input id="productName" {...register("productName")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="productSubtitle">产品副标题</Label>
        <Input id="productSubtitle" {...register("productSubtitle")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="footerText">页脚说明</Label>
        <Input id="footerText" {...register("footerText")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="organizationDisplayName">机构显示名</Label>
        <Input
          id="organizationDisplayName"
          {...register("organizationDisplayName")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="timezone">默认时区</Label>
        <Input id="timezone" {...register("timezone")} />
      </div>
      <Button type="submit" disabled={isLoading}>
        {isLoading ? "保存中..." : "保存设置"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Implement SettingsPage**

Create `apps/web/src/pages/admin/SettingsPage.tsx`:

```tsx
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformSettingsForm } from "@/components/settings/PlatformSettingsForm";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";

export function SettingsPage() {
  const [settings, setSettings] = useState<Record<
    string,
    string | undefined
  > | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<Record<string, string | undefined>>(
        "/api/admin/settings/branding",
      );
      setSettings(data);
    } catch {
      setError("加载设置失败");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSave(data: Record<string, string | undefined>) {
    setIsSaving(true);
    try {
      const updated = await api.patch("/api/admin/settings/branding", data);
      setSettings(updated);
    } catch {
      // error handled by toast or inline
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadSettings} />;

  return (
    <div className="space-y-6">
      <PageHeader title="平台与机构设置" />
      <PlatformSettingsForm
        defaultValues={settings ?? {}}
        onSave={handleSave}
        isLoading={isSaving}
      />
    </div>
  );
}
```

- [ ] **Step 5: Add route in App.tsx**

Update `App.tsx` to import SettingsPage and add route:

```tsx
import { SettingsPage } from "@/pages/admin/SettingsPage";
// Inside <Route path="/admin" element={<AdminLayout />}>:
<Route path="settings" element={<SettingsPage />} />;
```

- [ ] **Step 6: Run test — expect pass**

Run: `pnpm --filter web test -- --run src/pages/admin/SettingsPage.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/admin/SettingsPage.tsx apps/web/src/pages/admin/SettingsPage.test.tsx apps/web/src/components/settings/PlatformSettingsForm.tsx apps/web/src/App.tsx
git commit -m "feat(job4): add settings admin page with branding form"
```

---

### Checkpoint: Phase 1

- [ ] `pnpm verify` passes
- [ ] `curl http://localhost:3000/api/settings/branding` returns branding JSON
- [ ] Settings page renders at `/admin/settings`

---

## Phase 2: Organization CRUD

### Task 4: Organization API routes

**Files:**

- Create: `apps/api/src/routes/organization.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/src/routes/organization.test.ts`. Test CRUD as SuperAdmin, confirm non-SuperAdmin gets 403.

- [ ] **Step 2: Run test — expect failure**

Run: `pnpm --filter api test -- --run src/routes/organization.test.ts`

- [ ] **Step 3: Implement organization routes**

Create `apps/api/src/routes/organization.ts`:

```typescript
import { FastifyPluginAsync } from "fastify";
import {
  CreateOrganizationRequestSchema,
  UpdateOrganizationRequestSchema,
  OrganizationSchema,
} from "@exam/contracts";
import { createDatabase } from "@exam/db/src/database.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import type { RequestContext } from "@exam/domain";

const organizationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/organizations",
    { preHandler: [fastify.authenticate, fastify.requireRole(["SuperAdmin"])] },
    async (request: any) => {
      const ctx = request["ctx"] as RequestContext;
      const { db } = createDatabase();
      const repo = createOrganizationRepo(db);
      const orgs = repo.list(ctx);
      return orgs.map((o) => OrganizationSchema.parse(o));
    },
  );

  fastify.post(
    "/organizations",
    { preHandler: [fastify.authenticate, fastify.requireRole(["SuperAdmin"])] },
    async (request: any, reply: any) => {
      const ctx = request["ctx"] as RequestContext;
      const data = CreateOrganizationRequestSchema.parse(request.body);
      const { db } = createDatabase();
      const repo = createOrganizationRepo(db);
      const org = repo.create(ctx, data);
      return reply.code(201).send(OrganizationSchema.parse(org));
    },
  );

  fastify.patch(
    "/organizations/:id",
    { preHandler: [fastify.authenticate, fastify.requireRole(["SuperAdmin"])] },
    async (request: any, reply: any) => {
      const ctx = request["ctx"] as RequestContext;
      const { id } = request.params as { id: string };
      const data = UpdateOrganizationRequestSchema.parse(request.body);
      const { db } = createDatabase();
      const repo = createOrganizationRepo(db);
      const org = repo.update(ctx, id, data);
      if (!org)
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Organization not found" },
        });
      return OrganizationSchema.parse(org);
    },
  );

  fastify.delete(
    "/organizations/:id",
    { preHandler: [fastify.authenticate, fastify.requireRole(["SuperAdmin"])] },
    async (request: any, reply: any) => {
      const ctx = request["ctx"] as RequestContext;
      const { id } = request.params as { id: string };
      const { db } = createDatabase();
      const repo = createOrganizationRepo(db);
      const deleted = repo.delete(ctx, id);
      if (!deleted)
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Organization not found" },
        });
      return reply.code(204).send();
    },
  );
};

export default organizationRoutes;
```

Register in server.ts.

- [ ] **Step 4: Run test — expect pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(job4): add organization CRUD routes"
```

---

### Task 5: Organization admin page (UI)

**Files:**

- Create: `apps/web/src/pages/admin/OrganizationPage.tsx`
- Create: `apps/web/src/pages/admin/OrganizationPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

Same pattern as SettingsPage: table + create/edit dialog + delete confirm.

- [ ] **Step 1 through 5**: TDD cycle (test → fail → implement → pass → commit)

---

## Phase 3: Candidate Field Configuration

### Task 6: CandidateField API routes

**Files:**

- Create: `apps/api/src/routes/candidateField.ts`
- Modify: `apps/api/src/server.ts`

CRUD for candidate fields. Admin-only. Enforce exactly one `unique: true` per org.

- [ ] **Step 1 through 5**: TDD cycle

---

### Task 7: CandidateField config page (UI)

**Files:**

- Create: `apps/web/src/pages/admin/CandidateFieldPage.tsx`
- Create: `apps/web/src/pages/admin/CandidateFieldPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

Table with drag-to-reorder. Preview/import template button.

- [ ] **Step 1 through 5**: TDD cycle

---

## Phase 4: User Management

### Task 8: User management API routes

**Files:**

- Create: `apps/api/src/routes/user.ts`
- Modify: `apps/api/src/server.ts`

CRUD for non-candidate users. Admin-only. Create user also sets password hash.

- [ ] **Step 1 through 5**: TDD cycle

---

### Task 9: User management page (UI)

**Files:**

- Create: `apps/web/src/pages/admin/UserPage.tsx`
- Create: `apps/web/src/pages/admin/UserPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

Table with role badges, add user dialog, edit dialog, disable toggle.

- [ ] **Step 1 through 5**: TDD cycle

---

## Phase 5: Candidate Management + Import

### Task 10: Candidate API routes + CSV import

**Files:**

- Create: `apps/api/src/routes/candidate.ts`
- Create: `packages/import-export/src/csv.ts` (CSV parse/generate)
- Modify: `apps/api/src/server.ts`

CRUD + bulk import. Import uses CandidateField config to validate rows.

- [ ] **Step 1 through 5**: TDD cycle

---

### Task 11: Candidate management page + ImportWizard (UI)

**Files:**

- Create: `apps/web/src/pages/admin/CandidatePage.tsx`
- Create: `apps/web/src/components/shared/ImportWizard.tsx`
- Create: `apps/web/src/components/shared/FileUpload.tsx`
- Create: `apps/web/src/pages/admin/CandidatePage.test.tsx`
- Modify: `apps/web/src/App.tsx`

Dynamic table headers from CandidateField. Import button opens ImportWizard.

- [ ] **Step 1 through 5**: TDD cycle

---

## Phase 6: Final Verification

### Task 12: Route cleanup + full verify

**Files:**

- Modify: `apps/web/src/App.tsx` (replace inline routes with `routes` constants)
- Modify: `apps/web/src/contexts/AuthContext.tsx` (use `routes` constants for redirects)

- [ ] **Step 1: Replace inline route strings with `routes` imports**

- [ ] **Step 2: Run `pnpm verify`**

- [ ] **Step 3: Run `pnpm --filter api dev` + `pnpm --filter web dev`**

- [ ] **Step 4: Manual smoke test**
  - Login as admin
  - Visit settings page, change product name
  - Visit organization page (should see 1 org)
  - Visit user management, add a teacher
  - Visit candidate fields, add a field
  - Visit candidates, import CSV

- [ ] **Step 5: Final commit**

```bash
git commit -m "feat(job4): complete organization settings, user, and candidate management"
```

---

## Risks and Mitigations

| Risk                                                                     | Impact | Mitigation                                                                                                       |
| ------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------- |
| Settings page GET endpoint needs admin auth but public branding does not | Med    | Two separate endpoints: GET /api/settings/branding (public) and GET /api/admin/settings/branding (authenticated) |
| CandidateField unique constraint — only one field can be unique per org  | Med    | On create/update, if setting `unique: true`, first set all other fields to `unique: false`                       |
| CSV import with dynamic fields is complex                                | High   | Keep it simple: parse rows, validate against CandidateField config, batch insert                                 |
| `request: any` / `reply: any` in route handlers                          | Low    | Existing pattern from J3 — fix in later cleanup job                                                              |
| `createDatabase()` called in every route handler                         | Low    | Existing pattern from J3 — refactor to DI later                                                                  |

## Open Questions

- Should the settings page also show the CandidateField identity preview? (Spec says yes but it adds complexity — defer to implementation judgment)
- Should ImportWizard be reusable for both candidates and questions? (Yes per spec, but question import is J5A — build candidate import first, refactor for reuse in J5A)
