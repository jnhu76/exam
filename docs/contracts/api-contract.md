# API Contract

> **Canonical message / error / i18n contract home.**
> The frozen semantics below are the authority for user-facing message,
> error, and localization behavior. They were frozen by #413 C0
> (Message Contract Freeze); the program-level tracker is #417 and the
> slice contract is #418. Runtime remediation slices C1–C6 implement
> the TARGET semantics marked below — nothing in this document
> authorizes a runtime change before its slice lands.

## Source of truth

The canonical API contract is generated from **runtime Fastify/Zod route schemas**.

Each route declares its request validation (`params`, `querystring`, `body`) and
response serialization (`response`) as Zod schemas in the route options. These
schemas are the single source of truth: they validate incoming requests at
runtime, constrain outgoing responses, and feed the generated OpenAPI spec.

**Generated OpenAPI** (`/api/docs/json`) is the canonical machine-readable
artifact. It is derived from the same Zod route schemas via
`fastify-type-provider-zod`'s `jsonSchemaTransform`.

Hand-written documentation (including `api-reference.md`) is
**human-readable guidance** and may lag behind the generated OpenAPI. If this
document or any hand-written doc conflicts with generated OpenAPI or route
schemas, **generated OpenAPI / route schemas win**.

## Runtime-first policy

### Request validation

`params`, `querystring`, and `body` schemas are **runtime validators**.

- Malformed path params, query strings, or request bodies return
  `400 VALIDATION_ERROR` before the handler runs.
- The Zod type-provider extracts structured field-level error details.
- Client branching must use `error.code` / `error.details.reason` /
  `details.fields[].code`, never `error.message`.

### Response serialization

`response` schemas are **runtime serialization contracts**.

- The Zod serializer compiler constrains every declared status code to its
  declared schema.
- Response fields **not declared** in the response schema are not part of the
  public API contract and may be stripped or cause a serialization failure.
- If a handler returns a payload that does not match the declared response
  schema, Fastify catches the mismatch and returns `500 INTERNAL_ERROR`.

### Tests

Tests should assert the **runtime contract** — the shapes declared in route
schemas and the error codes/structures returned by `buildErrorResponse` /
`buildValidationErrorResponse`. Do not assert undocumented legacy behavior.
The layer-specific test contract for messages is defined below under
[D0.13 — Test contract](#d013--test-contract).

## Error response contract

All standardized API errors use a single envelope:

```json
{
  "error": {
    "code": "RESOURCE_CONFLICT",
    "message": "资源状态冲突",
    "requestId": "req-...",
    "details": {}
  }
}
```

**Required fields:**

| Field              | Type     | Description                                                       |
| ------------------ | -------- | ----------------------------------------------------------------- |
| `error.code`       | `string` | Stable coarse product-level `ErrorCode` (see D0.2)                |
| `error.message`    | `string` | Non-authoritative compatibility text (see D0.5) — current server default is zh-CN |
| `error.requestId`  | `string` | Fastify request id (for support correlation)                      |

**Optional fields:**

| Field            | Type      | Description                                                       |
| ---------------- | --------- | ----------------------------------------------------------------- |
| `error.details`  | `unknown` | Structured context — shape varies by `error.code` (see D0.8)      |

## Message & Error Contract

The following decisions are frozen. `CURRENT` states current as-built
behavior; `TARGET` states the frozen target; `MIGRATION RULE` states how
the transition happens. A TARGET that is not yet implemented is not
current wire behavior — do not build runtime code against it before its
slice lands.

### D0.1 — HTTP status

HTTP status is a **transport-level coarse outcome**. It is independent
from the product `ErrorCode` and must not be treated as sufficient domain
semantics. A code clarifies a status; it does not override it.

### D0.2 — ErrorCode

`error.code` is a **stable coarse product-level machine contract**. Its
authoritative catalog is `packages/contracts/src/messageRegistry.ts`
(`errorMessages`), and the API boundary guarantees that every code emitted
on the wire is a registered value (`normalizeErrorCode` in
`apps/api/src/plugins/errors.ts`).

Rules:

- Existing published values are stable: do not renumber, and do not
  silently re-mean an existing code.
- Multiple specific domain failures **MAY share one `ErrorCode`** when
  they genuinely belong to that coarse category. `RESOURCE_CONFLICT`
  carrying course-code conflicts, course-has-questions, exam-state
  conflicts, retake deferral, enrollment conflicts, and not-yet-finished
  scores is legitimate.
- Adding a new specific domain failure does **not** automatically require
  a new `ErrorCode`.
- When specialization is needed, the `(code, reason)` pair identifies the
  specific semantic (see D0.3).
- The invariant: a code must never be re-pointed at a different coarse
  category, and a reason must never be redefined within its code's space.
- Reason specialization is additive: introducing a reason for a failure
  that previously emitted none (`(code, absent)` → `(code, REASON)`) is
  an allowed additive specialization. Once a reason value is published
  for a specific failure, that failure MUST keep emitting that reason
  (no `REASON_A → REASON_B` reassignment, no silent drop back to absent).

Explicitly rejected:

```text
one ErrorCode = one unique logical failure
```

**CURRENT:** the registry holds ~60 codes; some codes carry multiple
specific failures. Since C1, the overloaded `RESOURCE_CONFLICT` business
failures identified by #413 (course-code conflict, course-has-questions,
exam-profile name conflict) emit `details.reason` (plus `details.params`
where a dynamic fact exists); the generic PG-conflict and candidate-create
23505 fallbacks stay reason-less by design (heterogeneous constraint set).
**TARGET:** frozen as above; no new codes for domain specializations.
**MIGRATION RULE:** none required — documentation-only (C0).

### D0.3 — reason

`error.details.reason` is an **open-vocabulary stable machine contract**.

It is **not** "non-contract", and it is **not** a closed global enum:

```text
open vocabulary  !=  non-contract
extensible contract  !=  closed enum
```

Rules:

- `UPPER_SNAKE_CASE`.
- Optional — introduced only when finer machine semantics are useful.
- New values MAY be added; already published values MUST NOT be redefined.
- Once a specific failure emits a reason, it MUST keep emitting that same
  reason. Introducing a reason where none was previously emitted is an
  allowed additive specialization (see D0.2) — it does not violate
  stability.
- Clients MAY branch on reasons they understand and MUST tolerate unknown
  reasons (falling back to `ErrorCode`-level semantics).

**CURRENT:** twelve ad-hoc `details.reason` values are already emitted
(e.g. `EXAM_NOT_FINISHED`, `CANNOT_DISABLE_SELF`, `TARGET_USER_INACTIVE`),
with no canonical description until this document. Since C1, the formerly
prose-only conflicts also carry reasons: `RESOURCE_CONFLICT +
COURSE_CODE_EXISTS` / `COURSE_HAS_QUESTIONS` (course routes, with
`details.params`) and `RESOURCE_CONFLICT + EXAM_PROFILE_NAME_EXISTS` (exam
profile routes, with `details.params`). `COURSE_CODE_EXISTS` is
path-independent: it is emitted for the same `(organization_id, code)`
unique failure on the create pre-check, the create DB race path, and the
rename path (PATCH), classified by the structured `courses_org_code_unique`
constraint match — never by error message text. The generic PG-conflict
fallback and the candidate-create 23505 fallback stay reason-less by design
(heterogeneous constraint set).
**TARGET:** frozen as above; no new codes for domain specializations.
**MIGRATION RULE:** additive only — new reasons never change the meaning
of existing codes or reasons.

### D0.4 — params

`error.details.params` and `details.fields[].params` are **structured
machine-readable dynamic context**.

The invariant (adopted from AIP-193):

> Any request-specific/dynamic fact that a machine may need and that
> appears in human-readable copy MUST also be represented structurally.

Clients must not be required to parse prose to obtain dynamic values.
Target value domain is minimal and should remain:

```ts
Record<string, string | number>
```

Params are additive-only: new keys may be added, existing keys are not
redefined or removed.

**CURRENT:** since C1, top-level `details.params` are emitted where a
machine-relevant dynamic fact exists: `courseCode` (duplicate course code),
`questionCount` (non-empty course deletion), `name` (duplicate exam profile
name). Since C2, field-level `details.fields[].params` are emitted where a
structured fact exists: Zod issue metadata (`minimum` / `maximum` /
`expected` / `received` / `validation`, derived only from structured issue
properties — never from `issue.message`), the failing candidate identity
field's `label`, and the missing referenced entity's `resource`
(`course` / `examProfile`) on exam route-local field errors. Facts outside
the frozen `string | number` domain (e.g. Zod `options` arrays) are
omitted, never widened.
**TARGET:** as above.
**MIGRATION RULE:** additive. If repository reality ever proves that
boolean/null/etc. values are genuinely required, report the divergence
for human review instead of widening the contract silently.

### D0.5 — message

`error.message` (and field-level `message`) is **non-authoritative
human-readable compatibility text**.

- Machine clients MUST NOT parse it.
- Production control flow MUST NOT branch on it.
- Wording is not a stable semantic contract; language is not a machine
  contract.
- The current server default is a zh-CN presentation fallback. zh-CN is
  **not** negotiated request-locale semantics; it is a product choice for
  the current single-language deployment.
- Changing the presentation language later must not affect
  `code` / `reason` / `params`.

The current product choice — server default compatibility message in
zh-CN — is documented here as a **current presentation/fallback decision**,
not an eternal API semantic. `message` is an **indefinitely retained
compatibility field with no planned removal in this remediation program**;
a future deprecation, if ever desired, requires a separate compatibility
decision.

**CURRENT:** the server fills top-level `error.message` from the
contracts registry (`getErrorMessage` / `getMessageForLocale` in
`messageRegistry.ts`), always in zh-CN. Since C1, both former ad-hoc
English override channels (`helpers.formatZodError`, `scores.ts`) are
removed and `buildErrorResponse` no longer accepts a message override;
the top-level message is always the registry text for the code.
Field-level and import `message` values are
**producer-local compatibility text** (Zod issue messages and
route/helper strings), not registry output. The first-party web client
re-resolves known codes against the registry and ignores the server
`message`; it uses the server `message` only for unknown codes.

**TARGET (top-level `error.message`):** always registry zh-CN
compatibility text. — implemented by C1.

**TARGET (field-level / import `message`):** non-authoritative
compatibility text whose language and producer are not machine
contract; C0 does **not** require registry ownership of it. Since C2,
first-party field consumers resolve known field codes from
`code + params` (D0.7) and no longer depend on this text — field copy
is not re-homed into the registry.

In both zones the web never treats `message` as authoritative copy
(C3).
**MIGRATION RULE:** wording changes are never breaking once documented;
tests pin machine semantics, not message text (D0.11).

### D0.6 — Machine vs human control flow

> Human-readable message text MUST NOT determine machine behavior.

Forbidden pattern for externally observable semantic classification:

```ts
if (error.message.includes("duplicate key")) { /* ... */ }
```

Allowed uses of message text: developer logging, diagnostic formatting,
compatibility display fallback.

**CURRENT:** since C1, the PG constraint-text fallback in
`apps/api/src/plugins/errors.ts` (F-10a) is removed — external 409/500
classification uses only structured SQLSTATE codes (`23505`, `40001`).
The local Redis sentinel (F-10b, hygiene only) remains and is C6 scope.
**TARGET:** zero production control-flow dependencies on message text.
**MIGRATION RULE:** F-10a closed by C1; the remaining F-10b item is hygiene.

### D0.7 — Field violations

`details.fields[]` is the field-level error channel.

**CURRENT shape (wire, since C2):**

```ts
{
  field: string;   // dot path; array indexes use `items.0.name` (see path note)
  code: string;    // machine semantic: Zod issue code or domain reason code
  params?: Record<string, string | number>; // structured dynamic values (D0.4)
  message: string; // compatibility human text, non-authoritative —
                   // may be Chinese (routes) or English (Zod defaults)
}
```

`params` is emitted only where a structured fact exists: Zod issue
metadata, the failing candidate identity field's `label`, and the
missing referenced entity's `resource` on exam route-local field errors.
Existing field `code` values are kept stable (published field codes are
not re-pointed); new codes may be added additively.

**Path convention — TARGET DEFERRED (C2 verdict):** the C0 TARGET prefers
bracket indexes (`questions[0].options[1]`), but C2 keeps the current
dot-index encoding. Evidence: first-party consumers key field errors by
the exact path string (e.g. the candidate dialog maps server
`fields.<name>` paths onto its form keys), so a bracket migration must
rewrite every producer and consumer in one slice — a breaking change to
public paths with no demonstrated external demand. The C2 success
criterion (wording independence) is fully achievable on dot paths; any
future bracket migration is a separate compatibility decision and must
follow the D0.9-style inventory gate.

**TARGET shape (frozen; `params` + machine-code consumption implemented
by C2):**

```ts
{
  field: string;
  code: string;    // machine semantic: Zod issue code or domain reason code
  params?: Record<string, string | number>; // structured dynamic values
  message: string; // compatibility human text, non-authoritative —
                   // indefinitely retained; demotion to optional or
                   // removal requires a separate compatibility decision
}
```

`message` remains a **required** wire field in the TARGET: it stays
non-authoritative compatibility text, but C0/C2 do not demote it to
optional — a future `required → optional` demotion would be a separate
compatibility decision, consistent with D0.5's indefinite-retention rule.

Semantic ownership:

```text
field   = machine-addressable field/path
code    = machine semantic
params  = structured dynamic values
message = compatibility human text, non-authoritative
```

**MIGRATION RULE (additive, no breaking removal in C0/C2):** existing
`field.message` remains; new machine fields are additive; since C2 the
first-party web resolves `code + params` and uses `message` only as the
unknown-code fallback (D0.10) while it stays a required wire field.
Future required→optional demotion or removal, if ever desired, requires
a separate compatibility decision.

**First-party consumption (CURRENT, since C2):** the Web field-error
resolver (`apps/web/src/lib/apiErrors.ts`) maps known field codes to
localized copy in the `validation.field.*` catalog namespace, interpolating
`params` (with `resource` resolved through `validation.field.resources.*`);
unknown codes fall back to the compatibility `message`, then to a generic
localized field error. Known codes never consult `message`, so backend/Zod
wording changes cannot alter first-party field semantics.

### D0.8 — Disabled / blocking reason

The legacy `scoreViewDisabledReason` / `deleteDisabledReason` fields are
**natural-language human text** today. They MUST NOT be silently changed
to a machine enum in place. The frozen migration is **additive**:

```text
legacy: scoreViewDisabledReason: human text
new:    scoreViewDisabledReasonCode: machine enum   (C1)

legacy: deleteDisabledReason: human text
new:    deleteDisabledReasonCode: machine enum      (C1)
```

The invariant:

> Existing natural-language field MUST NOT silently change semantic type.

**MIGRATION RULE:** server dual-emits → web adopts the machine code →
the legacy human field becomes compatibility-only → deletion/deprecation
is a separate future decision.

The machine reason set may be a small closed enum with explicit
unknown/fallback semantics if the current domain state space supports it
(C1 inventories the exact values). Exact field naming may be adjusted to
repository conventions, but the additive invariant is mandatory.

**CURRENT:** since C1 the server dual-emits:
`scoreViewDisabledReasonCode` (`EXAM_CANCELED | EXAM_NOT_FINISHED |
NO_GRADED_ATTEMPTS`, nullable) beside `scoreViewDisabledReason`, and
`deleteDisabledReasonCode` (`EXAM_NOT_DRAFT`, nullable) beside
`deleteDisabledReason`, on the exam list item. The legacy natural-language
fields are unchanged. Browser consumption of the codes is C3 scope.

**MIGRATION RULE:** server dual-emits (C1, done) → web adopts the machine
code (C3) → the legacy human field becomes compatibility-only →
deletion/deprecation is a separate future decision.

### D0.9 — `details` extensibility

`error.details` is currently `z.unknown()` — intentionally permissive
because brownfield shapes are broader than the proposed
`reason / params / fields` object. Evidence: `details.serverAnswer` in the
save-answer protocol.

Any future narrowing of the `details` schema is **inventory-gated**:
before introducing a stricter structured schema, every production
`error.details` shape on the baseline must be inventoried. The eventual
schema must be either a compatible union covering all legitimate shapes
or an extensible/passthrough object preserving existing shapes.

> No destructive narrowing without proof.

**CURRENT:** `z.unknown()`. The C1 inventory covered every production
producer (validation `fields[]`, `reason`/`reason+activeAttemptCount`,
`targetRole`, typed domain-error tuples with dates/numbers/strings, and the
SaveAnswerRejected `serverAnswer` object). Narrowing to a structured schema
is not proven covered by these shapes, so C1 keeps `z.unknown()`;
**VERDICT: KEEP_UNKNOWN** — any future narrowing stays inventory-gated.
**TARGET:** a compatible union or passthrough object — decided and
implemented by C1 after the inventory. C1's decision: keep permissive.
**MIGRATION RULE:** any future narrowing requires a fresh inventory.

### D0.10 — Unknown / forward-compatibility contract

Exact client rules, frozen:

#### Unknown ErrorCode

```text
unknown ErrorCode
→ server compatibility message
→ generic localized fallback if no usable message
```

#### Known ErrorCode + unknown reason

```text
known ErrorCode + unknown reason
→ ignore unknown specialization
→ use ErrorCode-level fallback semantics/copy
```

#### Unknown field code

```text
unknown field code
→ generic field-level localized error
→ compatibility message may be used as fallback
```

#### Stability

```text
new code/reason MUST NOT change the meaning of existing code/reason
clients MUST tolerate additive unknown semantics
```

### D0.11 — Localization zones

Copy ownership is split into three zones.

**Zone A — Interactive Web.** Authority: `apps/web` i18n catalog. Known
machine semantics flow `ErrorCode / reason / field code + params` → Web
mapping → `t()` → user. The Web is the eventual owner of browser-visible
interactive copy (TARGET, implemented by C3).

**Zone B — Wire Compatibility.** Authority for top-level `error.message`:
the server default compatibility catalog
(`packages/contracts/src/messageRegistry.ts`). Field-level and import
compatibility messages are producer-local non-authoritative text — C0
does not re-home them into the registry (see D0.5). Purpose: unknown-
code fallback, basic non-Web consumer usability, support/debug context.
It is **not** the interactive Web localization authority.

**Zone C — Server-rendered Copy.** Examples: Email, persisted Inbox
notifications, server-generated documents where applicable. Authority:
the server renderer. Email/Inbox are a legitimate independent localization
boundary (ADR-011 §24); do not pull them into browser i18n.

### D0.12 — messageRegistry role

`packages/contracts/src/messageRegistry.ts` serves as:

```text
server default compatibility-message catalog
+ ErrorCode-related shared contract support
```

It is **not** the final browser localization catalog — interactive Web
copy belongs in the Web. C4 may later simplify dead locale machinery;
C0 does not delete or refactor it.

### D0.13 — Test contract

Layer-specific assertions, frozen:

- **Domain:** assert `code` / `reason` / `params` semantics; do not pin
  developer prose.
- **API:** assert HTTP status, `ErrorCode`, `reason`, `params`, and field
  `code`/path. Human `message` text is generally not a semantic
  assertion. Exceptions: security/non-leak negative tests, compat-message
  existence/non-empty tests, and explicit presentation-contract tests
  where justified.
- **Contracts:** assert the code registry closed set, wire schema
  (additive-only changes), and unknown-code type behavior — not registry
  copy text.
- **Web unit:** assert machine-semantic → localization key / intended
  presentation behavior and unknown fallback.
- **E2E:** may assert actual user-visible localized copy, because that
  layer explicitly tests presentation.

**CURRENT:** ~80 test sites pin wire message text (a migration cost,
tracked in #413 §N); ~255 sites pin machine semantics (correct). The
behavior tests that pin "web re-resolves known codes" and "unknown codes
fall back to server message" (web `api.test.ts`) are correct design
behavior and are retained.
**TARGET:** migration of the ~80 sites to machine-semantic assertions
happens slice-by-slice (C1–C4).
**MIGRATION RULE:** follow each slice's own test-migration scope.

## Status boundary

| Case                                               | Status |
| -------------------------------------------------- | -----: |
| Malformed params / body / querystring              |    400 |
| Unauthenticated                                    |    401 |
| Authenticated but forbidden                        |    403 |
| Valid-shaped, missing resource                      |    404 |
| Valid-shaped, domain / resource conflict            |    409 |
| Internal failure or response serialization failure  |    500 |

## OpenAPI coverage policy

- All business API routes should appear in generated OpenAPI.
- Routes returning standardized error responses should declare
  `ErrorResponseSchema` for those status codes in their `response` schema.
- If a route returns a legacy ad-hoc error body but does **not** declare
  `ErrorResponseSchema`, it is not serializer-bound for that status — Fastify
  will not apply the error response serializer. This is safe from a serialization
  mismatch perspective, but remains a documentation and consistency gap.
- Error-envelope fields carry semantic descriptions (F-16): `message`
  fields are described as non-authoritative compatibility text, and
  `reason`/`params`/`disabledReason` fields are described with their
  machine semantics where they already exist in the schema.

## Serializer-bound vs legacy paths

| Path            | Declaration                                  | Behavior                                                    |
| --------------- | -------------------------------------------- | ----------------------------------------------------------- |
| Serializer-bound| Route declares `ErrorResponseSchema` for status | Actual response must match the envelope. OpenAPI documents the error. |
| Legacy non-bound| Route does **not** declare that error status | Fastify will not serialize that error through the Zod compiler. No mismatch, but undocumented. |

Serializer-bound is the target state. Legacy non-bound paths should be tracked
as cleanup debt and converted incrementally.

## Related authority

- `docs/standards/i18n-copy-policy.md` — copy enforcement policy and the
  five-way copy taxonomy (browser / wire compat / server-rendered /
  developer diagnostics / data-format literals).
- `docs/contracts/api-reference.md` — human-readable API guide (may lag
  generated OpenAPI).
- `packages/contracts/src/messageRegistry.ts` — authoritative `ErrorCode`
  catalog and server default compatibility messages.
- Program: #417 (tracker) · #418 (C0) · #413 (source audit + architecture
  corrective).

## Known follow-ups

The following items are intentionally left out of this document's scope:

- Add missing `ErrorResponseSchema` declarations for `question.ts` error
  responses (400, 404).
- Add missing `ErrorResponseSchema` declarations for `exam.ts` error
  responses (400, 404, 409).
- Clean up `course.ts` legacy ad-hoc error envelopes (no `requestId`, no
  standardized code).
- Eventually regenerate or rewrite `api-reference.md` from generated
  OpenAPI.
- Future API reference / settings UI should consume generated OpenAPI, not the
  hand-written reference.
- Adopt `apps/api/src/openapi/routeMeta.ts` — replace inline `cookieAuth` /
  `idParamsSchema` / `x-role` definitions across route files with imports
  from this shared module to reduce duplication.
- C1–C6 implementation slices of the #413 remediation program (see #417).
