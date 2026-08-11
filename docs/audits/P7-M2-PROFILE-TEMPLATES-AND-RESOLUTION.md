# P7-M2 Profile Templates + Authoring-Time Resolution

**Status:** READY FOR HUMAN REVIEW
**Program:** P7-M2 — Exam policy profiles + authoring-time copy-on-apply
**Baseline (`origin/master`):** `73ad31cb` (PR #277 / P7-M1 merged)
**Branch:** `feat/p7-m2-profile-templates`

This document is the design/audit authority for P7-M2. It records the profile
model, the profile-safe field inventory, the copy-on-apply authority contract,
the resolution precedence, the persistence model, and the verification
evidence. It is binding input for P7-M3 (exam creation wizard).

P7-M1 is authoritative for policy semantics; M2 does not reopen its
architecture. M1's frozen seam (§14) made M2 exactly what M1 predicted:
"template persistence + resolution before publish," not an engine rewrite.

---

## 1. Executive conclusion

M2 introduces **organization-owned exam policy profiles**: small, typed,
reusable subsets of exam-policy defaults that Admin/Teacher may select while
creating an exam. Applying a profile is **COPY-ON-APPLY**: the profile's
values are materialized into the ordinary typed `exams` columns at creation,
the created Exam never reads the profile again, and later profile edits or
deletions can never change an existing (draft or published) Exam.

```text
Profile/template = editable authoring convenience
Profile/template ≠ execution authority

Profile selected during authoring
        ↓
server resolves/copies defaults (explicit request > profile > code default)
        ↓
ordinary typed Exam columns
        ↓
canonical M1 publish validation
        ↓
Published Exam row = immutable execution authority
```

**Hard rule (binding):** Runtime NEVER loads a profile to execute a Published
Exam. Profile lookup count in the runtime path = 0 (structural test + arch
boundary; §13).

**Scope:** 1 new table (`exam_policy_profiles`), 0 new Exam columns, 0 new
Attempt columns, 0 profile version/history tables, 0 inheritance, 0 org
default profile, 0 settings subsystem, 0 UI, 0 new permissions, 0 presets.

---

## 2. Baseline

- `73ad31cb` (origin/master, clean; PR #277 / P7-M1 merged).
- Verified P7-M1 artifacts present: `packages/domain/src/examPolicy.ts`,
  `packages/exam-engine/src/examPolicy.ts`,
  `docs/audits/P7-M1-EXAM-POLICY-AUTHORITY-AND-VALIDATION.md`;
  `publishExam → assertExamPolicyValid`; nullable draft-policy merge preserves
  explicit null; `ResolvedExamPolicy` is a typed value, not persisted JSON;
  no profile/template persistence existed.

## 3. Binding M1 authority model

M1 freezes the seam M2 fills:

```text
profile/template defaults + per-exam overrides
        ↓
resolve → ResolvedExamPolicy (typed value)
        ↓
canonical validate (M1 validator; publish revalidates whole policy)
        ↓
publish writes/finalizes existing typed Exam columns
        ↓
published row immutable = execution authority
```

M2 acceptance conditions (frozen by M1 §14) all hold:

- Runtime engine does NOT load a profile/template to execute a published exam.
- Attempt start consumes Exam authority only.
- Grading consumes Exam authority / Attempt evidence only.
- A profile/template change after publish does NOT affect a published exam or
  active attempt.

## 4. Profile vs Published Exam authority

| Aspect | Profile | Published Exam |
| --- | --- | --- |
| Nature | editable authoring template | immutable execution authority |
| Physical store | `exam_policy_profiles` (typed columns) | existing typed `exams` columns |
| Read at runtime | NEVER | always (live-read of the frozen row) |
| Lifecycle | hard delete (authoring data) | state machine (draft → published → …) |
| After apply | finished; no Exam references it | owns all applied concrete values |

`exams.profile_id` does NOT exist (M2 §4): no Exam→profile FK "merely for
provenance". Exam creation through a profile records provenance only in the
`exam.create` audit metadata (`sourceProfileId`, `sourceProfileName`).

## 5. Profile-safe field inventory

Each candidate proven (M1 matrix + runtime grep): currently supported,
actually consumed, reusable across Exams, meaningful before questions/schedule
exist.

| Field | Runtime consumer (evidence) | Status |
| --- | --- | --- |
| `durationMinutes` | `attemptCommands.ts:243` (`calculateDeadlineAt`) | SUPPORTED |
| `latestStartOffsetMinutes` | `attemptCommands.ts:233-235` (start gate) | SUPPORTED |
| `minSubmitAfterStartMinutes` | `attemptCommands.ts:375-379` (submit gate) | SUPPORTED |
| `retakePolicy` (Phase-1 subset) | `grading.ts:68,74` | SUPPORTED |
| `maxAttempts` | `grading.ts:69` | SUPPORTED |
| `scoreStrategy` | `grading.ts:324` | SUPPORTED |
| `resultPublicationMode` | `scores.ts:204,216` (candidate result view) | SUPPORTED |
| `interruptionTimePolicy` | `attemptCommands.ts:246` snapshot (ADR-013) | SUPPORTED |
| `interruptionGracePerIncidentSeconds` | snapshot + restore evaluation | SUPPORTED |
| `interruptionGracePerAttemptSeconds` | snapshot + restore evaluation | SUPPORTED |

## 6. Explicitly excluded fields

- **Exam-instance-specific:** `courseId`, `openAt`, `closeAt`,
  `passingScore`, `totalScore`, `questionIds`, `questionSnapshot`,
  `resultsPublishedAt`, lifecycle `status`, `title`/`description`,
  organization identity, Candidate/enrollment data.
- **Fixed Phase-1 dimensions (no meaningful choice):** `timingMode` (only
  `timed_window`), `questionSelectionMode` (only `manual`). Not stored just so
  a profile "looks complete".
- **Latent/unenforced control flags (P7-M1 §13):** ALL of `controlFlags`
  (`shuffleQuestions`, `shuffleOptions`, `detectTabSwitch`,
  `disableCopyPaste`, `requireQueue`, `batchSize`, `batchInterval`,
  `restrictIp`, `requireLockdown`) — none are enforced by the engine today.
  Including them would turn latent promises into profile promises. Recorded
  P2-CF-1..4 remain the truthfulness follow-ups (unchanged by M2).
- **Legacy flag:** `showResultImmediately` is deprecated input, superseded by
  `resultPublicationMode`; it is not part of profile semantics. It remains an
  explicit-request-input legacy coercion at exam create (see §10 note).

## 7. Persistence model

One table, `exam_policy_profiles`, with **explicit typed columns** (not a
`policy_defaults jsonb` blob — the small known set stays SQL-visible,
migration-readable, type-safe, and auditable):

```text
id  organization_id  name  description
duration_minutes
latest_start_offset_minutes (nullable, CHECK >= 0)
min_submit_after_start_minutes (nullable, CHECK >= 0)
retake_policy (CHECK Phase-1 subset)
max_attempts
score_strategy (CHECK 3 values)
result_publication_mode
interruption_time_policy (CHECK ADR-013 values)
interruption_grace_per_incident_seconds (nullable)
interruption_grace_per_attempt_seconds (nullable)
created_at  updated_at
```

DB CHECKs mirror the `exams` structural invariants (caps XOR, non-negative
offsets, ADR-013 policy values) plus duration > 0 and the Phase-1 retake /
score-strategy subsets — DB-visible contract for a NEW table.

Deliberately NOT added (M2 §9): `schema_version`, `profile_version`, history
table, event table, profile inheritance, `parent_profile_id`, generic
metadata JSON.

## 8. Organization ownership

`profile.organizationId == request target organization` is enforced by the
repository (all ops org-scoped via the tenant CRUD base) and the
`(organization_id, name)` unique index. Cross-org access fails closed with the
same response as a missing id (404 for CRUD; 400 `RESOURCE_NOT_FOUND` on
`profileId` at exam create) — no existence leak. Proven by tests: Org B cannot
view/update/delete Org A's profile, cannot apply Org A's profile to an exam,
and lists only its own.

## 9. CRUD contract

```text
GET    /api/exam-profiles          list (ordered, no pagination — small data)
POST   /api/exam-profiles          201 / 400 / 409 (duplicate (org, name))
GET    /api/exam-profiles/:id      200 / 404
PATCH  /api/exam-profiles/:id      200 / 400 / 404 / 409
DELETE /api/exam-profiles/:id      204 / 404
```

- All fields of a profile are explicit on create (a profile is a deliberate
  template; description defaults to `""`; caps are nullable).
- PATCH: partial; explicit `null` clears a nullable field; an empty patch is a
  no-op (returns the current profile, no audit); partial interruption input is
  merged with the profile's current resolved policy before ADR-013
  normalization (mirrors the exam-update path).
- Duplicate `(organization_id, name)` maps the 23505 violation to a stable
  409 `RESOURCE_CONFLICT` — no raw DB errors leak.
- Hard delete (profiles are editable templates, not published artifacts;
  exams materialize values at creation, so no Exam depends on the row).
- No pagination/filtering/search (profile counts are authoring-scale data).

## 10. Apply/resolution precedence

Precedence (M2 §18): **explicit request value > profile value > existing code
default**, preserving explicit `null`.

**ONE resolution path (M2 §20 Option A)** — no two drifting create schemas:

```text
raw request body
   │  (fastify body schema = defaults-free raw shape, so request.body carries
   │   TRUE caller presence — a Zod-inserted code default cannot defeat a
   │   profile default)
   ▼
profileId present?
   │
   ├─ no → canonical parse (defaults + refine) → data   [byte-identical to master]
   │
   └─ yes → load profile (org-scoped; unknown/foreign → 400 RESOURCE_NOT_FOUND)
           → applyExamProfileDefaults(profile, explicitOverrides)   [domain pure resolver]
           → inject each profile-resolved value where the raw body OMITS the field
             (undefined = omitted; null = explicit and wins)
           → canonical parse of the merged input (defaults + refine) → data
   ▼
interruption normalization (ADR-013, master-form) → canonical M1 validation → persist
```

Notes:

- `durationMinutes` may be omitted ONLY when a profile supplies it. Without a
  profile, the canonical refine emits the exact `invalid_type`/`Required`
  issue the schema previously produced — no-profile behavior is byte-identical.
- `resultPublicationMode`: explicit mode > explicitly-sent legacy
  `controlFlags.showResultImmediately` (deprecated request input) > profile
  default > code default (`immediate`). The legacy flag is NOT profile
  semantics; it only ever acts as explicit request input.
- The route keeps a fail-closed re-check that `durationMinutes` is defined
  after the canonical parse (defensive; the refine already rejects the
  no-profile omission).

## 11. null vs undefined semantics

`undefined` = no explicit override (profile value applies); `null` = explicit
semantic value (wins). The domain resolver (`applyExamProfileDefaults`) uses
`!== undefined` for every field — never `??`, which would erase an explicit
null (the M1 `null ?? oldValue` bug class). The route's merge is
presence-based on the raw body for the same reason. Regression-tested for
`latestStartOffsetMinutes` and interruption caps.

## 12. Copy-on-apply proof

Required integration tests (all passing):

1. **Profile edit after apply does NOT change an existing Exam:** create
   profile P(A) → create Exam E via P → PATCH P to B → read E → E still has A.
2. **Profile deletion after apply does NOT break the Exam:** create P → create
   E via P → DELETE P → publish E succeeds → candidate starts an attempt
   successfully (runtime consumes Exam authority only — and the attempt-start
   test actually exercises the materialized `latestStartOffsetMinutes` gate,
   proving the applied value is the running value).

## 13. Runtime non-dependency proof

- **Structural test** (`packages/exam-engine/src/runtimeProfileIndependence.test.ts`):
  no runtime execution module (non-test source in the engine package —
  attemptCommands, grading, manualGrading, deadline scanner, interruption/
  recovery, answer protocol, submission) contains an import whose specifier
  mentions "profile". PASS.
- **Dependency boundary:** the profile repository lives in `@exam/db`;
  `@exam/exam-engine` declares only `@exam/domain` as a dependency (package.json
  evidence) — the runtime path physically cannot reach the profile table.
- Candidate result paths (`scores.ts`, `attempts.candidate.ts`) are API routes;
  they import no profile module (grep-verified; the only profile import in the
  API is the authoring create/CRUD surface).
- M1's authority model is unchanged: attempt start/grading consume the
  published Exam row; publish runs `assertExamPolicyValid` on the materialized
  policy; no profile lookup exists anywhere in the execution path.

## 14. Validation ownership

| Layer | Owns |
| --- | --- |
| profile contracts (Zod) | shape/range, Phase-1 narrowing, name length, non-negative offsets |
| profile route | ADR-013 caps normalization via `normalizeInterruptionPolicyConfiguration` (shared leaf rule in `@exam/domain`) |
| domain resolver | pure precedence semantics (`applyExamProfileDefaults`) |
| **M1 canonical validator** | cross-field semantics of the FINAL materialized Exam policy (create + publish) — unchanged ownership; no `validateProfileExamPolicyV2` was created |
| DB CHECKs | structural invariants on the profile row |

Profiles are validated only for what they genuinely own (§17 of the M2 brief):
no fake `openAt`/`totalScore`/`questionIds` are constructed to call the M1
validator on a profile; the full M1 validator runs on the real materialized
Exam authoring request.

## 15. RBAC / audit

**RBAC — no new permission family.** Reuses the closest Exam-authoring
capabilities (M2 §14):

| Operation | Capability |
| --- | --- |
| read profiles (list/get) | `Permission.ExamView` |
| create profile | `Permission.ExamCreate` |
| update/delete profile | `Permission.ExamUpdate` |

`x-role` metadata mirrors exam authoring (`Admin` + `Teacher`); enforcement is
capability-based via the existing `requireCapability` gate. Documented reuse —
no dedicated `exam_profile.*` permission was added.

**Audit — existing subsystem, three new actions** in the closed catalog
(`@exam/authz` + the API audit policy registry):

```text
exam_profile.create   (best_effort, domain_state, low)
exam_profile.update   (best_effort, domain_state, low, changedFields payload)
exam_profile.delete   (best_effort, domain_state, low)
```

Exam creation through a profile records **provenance only** in the
`exam.create` audit metadata: `sourceProfileId` + `sourceProfileName`
(best_effort, optional payload schema). It is never consulted at runtime.
Profiles contain no secrets.

## 16. Migration

One additive migration: `0029_exam_policy_profiles` (1 table + unique index +
CHECKs + org FK). No Exam columns, no Attempt columns, no history tables.

```text
new tables: 1      new exam columns: 0      new attempt columns: 0
new profile history tables: 0               JSON policy blobs: 0
version tables: 0                           inheritance: 0
```

Verified: fresh DB (isolated test schemas) applies the migration; existing DB
migration check (`pnpm test:db-journal`, `pnpm lint:db-journal`) passes;
profile CRUD works; normal Exam create without a profile still works (full API
suite).

## 17. P0 / P1 / P2 / P3 findings

**P0:** 0.

**P1:** 0. The one real implementation bug found during development (the
interruption chain dropped explicit request values when no profile was
selected, because `resolvedDefaults` was null — the M1 `null ?? oldValue`
bug class) was caught by the existing `admin-time-grants` regression suite and
fixed by adopting §20 Option A (single resolution path), which eliminated the
special-cased chain entirely. The fix is regression-covered.

**P2:**

- **P2-1 (edge, documented):** an explicitly-sent `controlFlags` object whose
  `showResultImmediately` defaults to `true` wins over the profile's
  `resultPublicationMode` (legacy coercion is explicit request input). The M3
  wizard should stop sending `controlFlags` when a profile supplies the mode.
  This preserves the legacy coercion contract exactly.

**P3:**

- **P3-1:** the fastify body schema for POST /api/exams is now the raw
  defaults-free shape (OpenAPI no longer shows request defaults for
  `retakePolicy` etc.). Expected, documented small OpenAPI change (§36 of the
  brief); the canonical schema (defaults + refine) remains the single
  authoring contract.

## 18. P7-M3 handoff

M3 (exam creation wizard) can consume without changing authority semantics:

- `GET /api/exam-profiles` → profile picker source.
- `POST /api/exams { profileId?, ... }` → profile selection with
  copy-on-apply; explicit values and explicit nulls win; no-profile requests
  are byte-identical to today.
- No response field implies inheritance (`activeProfile`/`profileName`/…) was
  added to Candidate/runtime Exam responses (M2 §26).
- PATCH `/exams/:id { profileId }` is intentionally NOT supported (M2 §25) —
  re-applying a profile to an existing draft is a different UX/overwrite
  problem; if M3 genuinely needs it, it must be designed as an explicit
  "apply profile" operation, not an implicit field.
- Presets ("Minimal / Standard / Controlled / Strict") are intentionally NOT
  shipped (M2 §12): several dimensions needed to make those names truthful
  remain unimplemented or latent. A later product pass may ship presets after
  their semantics are proven.

## 19. Verification evidence

- **Domain resolver** — `packages/domain/src/examProfile.test.ts` (8 tests):
  profile-default application, explicit override wins, explicit null wins,
  undefined = no override, full field coverage, non-mutation, determinism.
- **Contracts** — `packages/contracts/src/examProfile.test.ts` (13 tests):
  durationMinutes/profileId refine matrix, profile create/update shape,
  Phase-1 retake narrowing, null handling, response shape.
- **DB repository** — `packages/db/src/repository/examProfileRepo.test.ts`
  (7 tests): org-scoped create/find/list/update/delete, fail-closed
  cross-org, deterministic ordering, 23505 unique constraint with exact
  constraint name, cross-org name reuse allowed.
- **API CRUD** — `apps/api/src/routes/examProfile.test.ts` (15 tests): full
  CRUD, duplicate-name 409 (create + rename), invalid interruption defaults
  rejected (create + update), non-Phase-1 retake rejected, RBAC denial,
  foreign-org fail-closed matrix.
- **Exam creation resolution** — `apps/api/src/routes/examProfileResolution.test.ts`
  (12 tests): no-profile compatibility (durationMinutes required; code
  defaults unchanged), profile defaults apply, explicit overrides win,
  explicit null wins, interruption override fail-closed, bounded_grace caps
  apply, unknown/foreign profileId → identical 400, canonical M1 validation
  still rejects invalid final policies, copy-on-apply (edit + delete), and
  publish + attempt-start after profile deletion.
- **Runtime independence** — `packages/exam-engine/src/runtimeProfileIndependence.test.ts`
  (1 structural test).
- **Regression suites:** M1 validator (596 engine tests incl. examPolicy),
  exam routes (66), attempts (incl. admin-time-grants 14, candidate-start),
  route-registry conformance (updated anchor 120 primary = 104 protected + 16
  non-protected), authz catalog, full API suite.
- **Gates:** `pnpm verify:static`, `pnpm test`, `pnpm build` (see final
  report for results).

---

P7-M2 PROFILE TEMPLATES + AUTHORING-TIME RESOLUTION — READY FOR HUMAN REVIEW
