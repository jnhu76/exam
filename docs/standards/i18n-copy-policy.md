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
to. But the allowlist must describe reality. A claim that copy is
"server-side only" is false when the dataflow proves it reaches the wire
and the client.

## Rule 1: No hardcoded user-visible Chinese in production source

Production source files (`apps/web/src/**` and `apps/api/src/**`, excluding tests, fixtures, seed, and locale catalog) must not contain user-visible Chinese strings. **Authoritative browser-interactive presentation copy** must be:

1. Defined in `apps/web/src/i18n/locales/zh-CN.ts`
2. Rendered via `t("key")` or `useTranslation()` in components

This rule is enforced by `pnpm lint:copy` (CI gate). The CJK gate scans
**both** `apps/web/src/` and `apps/api/src/`.

**Scope of "user-visible":** browser-interactive UI copy rendered by the
web client. It does **not** cover wire compatibility copy, server-rendered
copy (Email/Inbox), developer diagnostics, or data-format literals — see
the taxonomy above and the allowlist below. Those categories are governed
by the message contract and their own rules, not by this rule.

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

## Rule 4: CSV/template compatibility allowlist

CSV header matching and template content may contain Chinese. These are data format contracts, not user-facing copy.

Currently allowed:

- `apps/web/src/lib/candidateImport.ts` — CSV header aliases (用户名/密码/姓名)
- `apps/web/src/pages/admin/QuestionImportPage.tsx` — CSV template headers, parser tokens, example rows
- `apps/api/src/routes/export.ts` — scores CSV column headers + row values (考生姓名/成绩/及格状态/…). Data-format contract.
- `apps/api/src/routes/attempts.admin.ts` — attempt-detail CSV column headers + row values (题号/题型/题目内容/…). Data-format contract.
- `apps/api/src/routes/audit.ts` — audit-log export CSV column headers + row values (时间/操作/操作者/操作者ID/对象类型/对象ID/IP地址/请求ID). Data-format contract.

These are documented in `scripts/check-hardcoded-copy.mjs` with justification.

## Rule 5: Temporary allowlist requires justification

Any temporary allowlist entry must document:

- File path
- Reason (why Chinese is acceptable here)
- Removal condition (when the exemption expires)

Currently allowed:

- `apps/web/src/pages/PlaceholderPage.tsx` — temporary placeholder, remove when implemented

## Rule 6: Backend copy categories (apps/api/src)

The backend API contract is **code-driven**: the error handler
(`apps/api/src/plugins/errors.ts`) serializes an error *code*, never the
thrown message. Backend CJK falls into the categories below. The allowlist
entries must match the dataflow, not a claim.

- **Thrown validation/error messages** (e.g. `throw new ValidationError("课程不存在")`)
  are server-side log/debug copy. The error handler discards the thrown
  message and never puts it on the wire. These are allowlisted as developer
  diagnostics; standardizing them to English is a non-blocking follow-up.
- **API-provided status-reason strings** (`scoreViewDisabledReason` /
  `deleteDisabledReason` in `exam.ts`) are returned in the response body
  and rendered verbatim by the web client today. They are allowlisted as
  wire compatibility copy. Their legacy natural-language form is a known
  debt (F-2): the frozen migration is **additive** — new machine-code
  fields (`*DisabledReasonCode`) are added by C1, and the natural-language
  fields are **not** changed in place.
- **Field-validation messages placed into `details.fields[].message`**
  (`course.ts`, `question.ts`, `candidate.ts`) **reach the client**: they
  are put on the wire inside `error.details.fields[]` and rendered by
  first-party web field errors. These are **not** "server-side only"
  copy. They are allowlisted as wire compatibility copy today; the frozen
  target is `field + code + params` with `message` as fallback-only
  (message contract D0.7, implemented additively by C2).
- **Bulk-import row errors** (`candidate.ts`, `question.ts`) put
  `errors[].message` on the wire and persist it for the import log. Same
  category as above: wire compatibility copy, targeted by C2.

Backend files currently carrying allowlisted CJK:

- `apps/api/src/routes/exam.ts` — status-reason strings (Rule 6, wire compatibility copy; legacy natural-language, additive migration in C1).
- `apps/api/src/routes/course.ts`, `question.ts`, `candidate.ts` — field-validation and bulk-import messages that reach the wire via `details.fields[]` / `errors[]` (Rule 6, wire compatibility copy; target `code + params` in C2).
- `apps/api/src/routes/user.ts`, `attempts.candidate.ts` — thrown/inline validation messages (Rule 6, log-only; `attempts.candidate.ts` additionally carries `SaveAnswerRejected.message`, a wire compatibility field).

## Adding new allowlist entries

1. Edit `CJK_ALLOWLIST` in `scripts/check-hardcoded-copy.mjs`
2. Add entry with `path`, `reason`, and `removal` fields
3. Explain in PR why this is not UI copy
4. If temporary, set a removal condition

Allowlist entries must describe the actual dataflow. If copy is shown to be
on the wire and rendered by the client, the entry must say so (wire
compatibility copy) rather than claiming "server-side only".

## Enforcement

`pnpm lint:copy` runs as part of:

- `pnpm verify` (full pipeline)
- `pnpm verify:static` (pre-commit)
- CI checks on every push

Exit code 1 blocks the commit/merge.
