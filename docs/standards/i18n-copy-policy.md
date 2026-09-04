# i18n Copy Policy

> **Scope of this document:** copy *enforcement* and the copy taxonomy.
> The semantic authority for user-facing messages, error codes, reasons,
> params, and compatibility text is
> [`docs/contracts/api-contract.md`](../contracts/api-contract.md)
> (Message & Error Contract, frozen by #413 C0). This policy does not
> redefine that contract; it says which copy may exist where and how the
> hardcoded-copy gate treats it.

## Copy taxonomy

User-visible and user-adjacent copy in this repository falls into five
categories with different authorities:

| Category | Authority | Examples |
| --- | --- | --- |
| Browser localized copy | `apps/web` i18n catalog (`zh-CN.ts`) rendered via `t()` | All interactive UI labels and messages |
| Wire compatibility copy — top-level `error.message` | Server default compatibility catalog (`packages/contracts/src/messageRegistry.ts`); non-authoritative | `error.message` for unknown-code fallback / non-Web consumers |
| Wire compatibility copy — field/import `message` | Producer-local compatibility text (Zod issue messages, route/helper strings); non-authoritative; the registry does not own it (message contract D0.5) | `details.fields[].message`, bulk-import `errors[].message`, `SaveAnswerRejected.message` |
| Server-rendered localized copy | Server renderer (Email, Inbox notifications) — legitimate independent boundary (ADR-011 §24) | Email subject/body, Inbox title/body |
| Developer diagnostics | Logs and thrown messages that the error handler discards (never reach the client) | `throw new ValidationError("...")` copy |
| Data-format literals | The data format itself | CSV headers/values, import template rows, parser tokens |

The distinction matters: "Chinese in a backend source file" is not
automatically a violation — it depends on which category the copy belongs
to. But the enforcement must describe reality. A claim that copy is
"server-side only" is false when the dataflow proves it reaches the wire
and the client.

## Rule 1: No hardcoded user-visible Chinese in production source

Production source files (`apps/web/src/**`, `apps/api/src/**`, and
`packages/*/src/**`, excluding tests, fixtures, seed, and locale catalogs)
must not contain user-visible Chinese strings. **Authoritative
browser-interactive presentation copy** must be:

1. Defined in `apps/web/src/i18n/locales/zh-CN.ts`
2. Rendered via `t("key")` or `useTranslation()` in components

This rule is enforced by `pnpm lint:copy` (CI gate). The CJK gate scans
**both** `apps/` trees **and** every workspace package under
`packages/*/src/` — a new package is covered automatically.

**Scope of "user-visible":** browser-interactive UI copy rendered by the
web client. It does **not** cover wire compatibility copy, server-rendered
copy (Email/Inbox), developer diagnostics, or data-format literals — see
the taxonomy above and the enforcement model below. Those categories are
governed by the message contract and their own rules; in production source
they are declared with a narrow suppression directive, never a blanket
file exemption.

## Enforcement model (Tier 2)

The guard (`scripts/check-hardcoded-copy.mjs`) parses each production
source file with the TypeScript compiler API and flags every CJK string
literal, template literal, and JSX text node. Comments — including Chinese
comments — are never flagged, and `//` inside a string cannot disguise
copy as a comment.

A flagged literal is legal only in one of two ways:

**Catalog authorities.** Files whose declared architectural
responsibility *is* copy storage:

- `apps/web/src/i18n/locales/**` — the browser locale catalog
- `packages/contracts/src/messageRegistry.ts` — the server compatibility
  catalog (exact file; the privilege does not extend to sibling files)

This list is exact-path on purpose. Widening it to a package or directory
is a guard change and must be reviewed as such — a catalog exception must
never become a way for mixed production files to inherit blanket immunity.

**Narrow suppression directives.** Any other production CJK literal needs
an explicit directive comment adjacent to it:

```ts
// i18n-copy-allow: <category> — <reason>
message: "课程代码已存在",
```

- The directive applies to the CJK literal on its own line (trailing) or
  on the immediately following line; a block of consecutive directive
  comments is allowed for a multi-line reason. A blank line between the
  directive and the literal breaks the link.
- A multiline template literal (e.g. one Email body) is **one** semantic
  unit — one directive covers it, not the whole file.
- Suppression categories (frozen set):

| Category | Legitimate dataflow |
| --- | --- |
| `wire-compat` | Non-authoritative compatibility text carried on the wire (`details.fields[].message`, import `errors[].message`, legacy natural-language `*DisabledReason`); machine `code`/`reason`/`params` are the contract (message contract D0.x) |
| `server-rendered` | Email/Inbox copy rendered server-side; independent localization boundary, never routed through web i18n |
| `developer-diagnostic` | Thrown/log messages the error handler discards — the wire carries the code, never this text |
| `data-format` | CSV headers/aliases/parser tokens, placeholder-matching tokens — the data format itself |
| `temporary` | Placeholder copy awaiting implementation; the reason must state the removal condition |

- **Fail conditions:** an unknown category, a missing reason, a malformed
  directive, or a stale directive (no CJK literal on its own/next line)
  each fail the gate. An invalid directive never silently suppresses the
  literal next to it.
- **No file-level bypass exists.** A directive covers its literal, never
  the file; an unrelated new literal in the same file still fails.

**Test-only classification.** The gate excludes genuine test-only content
by *structure*, not by filename: `*.test.*` / `*.spec.*` / `*.stories.*`
files, `__tests__/` and `testHelpers/` **directories**, `fixtures/`
directories, e2e/demo seed, and the dev-only labs under
`apps/web/src/dev/`. A production file named `foo.testHelpers.ts` gets **no**
exemption from its name and is scanned like any other production file.

**Tier 1** (deployment-specific terms such as 校内/大学/student) is
independent of this model and scans all text files under `apps/` and
`packages/`; the terms are forbidden everywhere except docs, tests,
stories, and demo seed.

## Rule 2: zh-CN catalog is the single source of truth for browser-interactive copy

All browser-interactive Chinese UI text lives in
`apps/web/src/i18n/locales/zh-CN.ts`. Components reference keys, not strings.

**Wrong:**

```tsx
<Button>保存</Button>
```

**Correct:**

```tsx
<Button>{t("common.save")}</Button>
```

The zh-CN catalog is **not** the authority for every human-readable string
in the system. In particular, the server's wire compatibility messages are
**non-authoritative compatibility text** (see the message contract):
top-level `error.message` is produced by
`packages/contracts/src/messageRegistry.ts`, while field-level / import
`message` values are producer-local compatibility text (Zod issue
messages, route/helper strings) — the registry does not own them
(message contract D0.5). The web client re-resolves
known codes against its own catalog and uses server messages only as an
unknown-code fallback. Duplicate or near-duplicate wording between the web
catalog and the compatibility sources is therefore **intentional layering,
not a defect**, as long as the semantic authority is unambiguous — machine
semantics (`code` / `reason` / `params`) are the contract; wording is not.

## Rule 3: Test assertions use resolved Chinese

Tests may assert the final rendered Chinese text. This verifies the i18n pipeline works end-to-end.

**Allowed:**

```ts
expect(screen.getByText("保存成功")).toBeInTheDocument();
```

**Forbidden:**

```ts
expect(screen.getByText("common.saveSuccess")).toBeInTheDocument();
```

This rule governs web UI output assertions. It does **not** override the
test contract in the message contract (D0.13): API/domain/contract tests
assert machine semantics (`code` / `reason` / `params` / field `code`+path)
and generally must not pin `message` text as a semantic assertion, except
for security/non-leak negative tests, compat-message existence/non-empty
tests, and explicit presentation-contract tests.

## Rule 4: CSV/template data-format copy

CSV header matching and template content may contain Chinese. These are
data format contracts, not user-facing copy, and stay in place with
`data-format` suppression directives.

Examples:

- `apps/web/src/lib/candidateImport.ts` — CSV header aliases (用户名/密码/姓名)
- `apps/web/src/pages/admin/QuestionImportPage.tsx` — CSV template headers, parser tokens (是→true), example rows
- `apps/api/src/routes/export.ts`, `attempts.admin.ts`, `audit.ts` — export CSV column headers + row values

A CSV-capable route file is **not** globally exempt: only the actual
data-format literals carry the directive; unrelated copy in the same file
still fails.

## Rule 5: Temporary copy requires a removal condition

Temporary product copy stays in place with a `temporary` directive whose
reason states when it goes away:

```tsx
// i18n-copy-allow: temporary — placeholder page awaiting implementation; remove with the page
return <div className="type-secondary">页面将在后续任务中实现。</div>;
```

When the placeholder no longer needs the exemption, the directive is
deleted with it. A stale directive fails the gate.

## Rule 6: Backend copy categories (apps/api/src, packages/*/src)

The backend API contract is **code-driven**: the error handler serializes
an error *code*, never the thrown message. Backend CJK falls into the
suppression categories above; the directive reason must match the actual
dataflow, not a claim:

- **Thrown validation/error messages** (`throw new ValidationError("课程不存在")`)
  → `developer-diagnostic`. The error handler discards the thrown message.
- **Field-validation messages placed into `details.fields[].message`**
  → `wire-compat`. They reach the client inside `error.details.fields[]`
  and are non-authoritative; the frozen target is `field + code + params`
  (message contract D0.7).
- **Bulk-import row errors** (`errors[].message`, persisted for import logs)
  → `wire-compat`.
- **Legacy natural-language status reasons** (`scoreViewDisabledReason` /
  `deleteDisabledReason`) → `wire-compat`. Their machine-code counterparts
  (`*DisabledReasonCode`) are additive; the natural-language fields are not
  changed in place (message contract, F-2 migration).
- **Server-rendered Email/Inbox copy** → `server-rendered`. ADR-011 §24
  keeps this an independent boundary; do not migrate it to web i18n.

Do **not** translate or reword compatibility copy merely to reduce
directives, and do **not** move backend compat copy into the web catalog —
enforcement classifies zones; it does not redefine them.

## Adding a legitimate exception

1. First check whether the copy actually belongs in a catalog: browser
   interactive copy goes to `apps/web/src/i18n/locales/zh-CN.ts` via `t()`.
2. Otherwise add a directive immediately above (or trailing) the literal:

   ```ts
   // i18n-copy-allow: <category> — <why this dataflow is legitimate>
   ```

3. The reason must describe the real dataflow ("handler serializes the
   code only", "CSV header data contract", "Email rendered server-side").
4. Explain the category choice in the PR.

Whole-file allowlist entries no longer exist; the catalog authority list in
the guard is exact-path and changes to it are reviewed as guard changes.

## Enforcement

- `pnpm lint:copy` — production scan (`scripts/check-hardcoded-copy.mjs`)
- `pnpm test:copy-guard` — permanent regression suite for the guard itself
  (`scripts/check-hardcoded-copy.test.mjs`): builds fixture repos and
  asserts what must fail and what must stay legal

Both run as part of `pnpm verify:static`, `pnpm verify`, and CI on every
push. Exit code 1 blocks the commit/merge.
