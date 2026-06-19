# P2B-J1 / P2B-J2 Remaining-Work Audit

> **Status**: Reference document. Captures what remains to close out P2B-J1
> (Admin Operation Flow Audit) and P2B-J2 (Admin Operation Hardening) after the
> ADR-005 four-slice implementation landed on `feat/p2b-exam-operation-baseline`.
>
> **Authority**: `docs/adr/ADR-005-exam-operation-state-baseline.md` is the
> implementation authority. P2B-J1/J2 are the original job cards (written
> pre-ADR); this document reconciles their acceptance criteria against actual
> implementation.

## Context — how the work was reshaped

P2B-J1/J2 were written **before** ADR-005. The P2B-J1 spike exposed a cluster
of missing exam-operation capabilities (no admin close, draft-only PATCH, no
timing policy, no cancel). Rather than patch piecemeal, the work was
redirected to a **design-first baseline** (ADR-005) and implemented as **four
slices**, which **superseded the original P2B-J2 scope**:

| Slice | Content | Status |
| --- | --- | --- |
| 1 | Close baseline (POST /exams/:id/close + scores/export unresolved guard + UI) | DONE |
| 2 | Unpublish / Extend / PATCH-clarify | DONE |
| 3 | Timing policy (latestStartOffsetMinutes, minSubmitAfterStartMinutes, SubmitSource) | DONE |
| 4 | Cancel-minimal (canceled state, cancel route, scores/export reject) | DONE |

All four slices are implemented, review-clean, and covered by 502 API + 497 web
tests. ADR-005 has no open questions.

## P2B-J1 acceptance-criteria audit

| Criterion | Status | Evidence |
| --- | --- | --- |
| Admin full loop E2E passes | **❌ NOT DONE** | `apps/e2e/e2e/admin-flow.spec.ts` does not exist on this branch. It exists only in the WIP spike commit `61ad5c9` on `feat/new-task` (tests #1 publish-lifecycle + #2 enrollment were green; #3 scores + #4 export were rewritten to use the close route). It must be landed here. |
| Gaps documented for P2B-J2 | ✅ DONE (exceeded) | Gap findings were not just documented — they were fixed via ADR-005. |
| No production code changed unless critical | ⚠️ Deviated (justified) | Production code was changed, but P2B-J1 §9's "unless critical gap" exemption applies: the gaps were critical (no admin close, no timing policy). Documented in the ADR. |

**P2B-J1 remaining = 1 item: land `admin-flow.spec.ts` on this branch.**

## P2B-J2 acceptance-criteria audit

| § | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| §7 | Setup validation (question count, score alignment) | ✅ DONE | `publishExam` already validates. |
| §7 | Assignment reliability + **batch validation** | ⚠️ PARTIAL | add/remove works; batch validation (§6 "no batch validation") not explicitly implemented — scope needs confirmation. |
| §7 | publish/open/close/archive transitions aligned + audited | ✅ DONE (exceeded) | close/unpublish/extend/cancel + audit events all implemented. |
| §7 | Score overview accessible from exam detail | ✅ DONE | "前往成绩管理" button + `exam-detail-go-scores-btn` testid. |
| §11/§22 | e2e `admin-flow.spec.ts` updated for hardened flow | **❌ NOT DONE** | Same as P2B-J1. |
| §22 | unit: examCommands validation tests | ✅ DONE | 220+ exam-engine tests. |
| §22 | integration: exam.test.ts, enrollment.test.ts | ✅ DONE (exam) / ⚠️ (enrollment batch) | exam.test.ts = 502 tests; enrollment batch tests pending. |
| §24 Risk1 | Stricter validation doesn't break demo seed | ✅ SAFE | demo-seed does not set the 2 timing fields (they default null). |
| §17 | DB/transaction | ✅ UPDATED | timing-field migration + cancel/close use transactions. |

**P2B-J2 remaining = 3 items** (see table below).

## Remaining-work list (priority order)

| # | Item | Owner job | Priority | Effort | Notes |
| --- | --- | --- | --- | --- | --- |
| **1** | **`apps/e2e/e2e/admin-flow.spec.ts`** — land the E2E on this branch | P2B-J1 §22/§23 + P2B-J2 §11/§22 | **HIGH** (core acceptance for both jobs) | Medium | The spec is mostly written in spike `61ad5c9` (tests #1/#2 green; #3/#4 rewritten for the close route). Cherry-pick, adjust to the final close/cancel routes, validate via Docker E2E against an isolated DB (not `exam-test-pg`). |
| 2 | Enrollment batch validation | P2B-J2 §6/§7 | MEDIUM (confirm scope first) | Small-Medium | §6 flags "no batch validation" as a gap. Confirm whether this is in-scope for P2B-J2 or deferred. |
| 3 | Archive route construction hard rule (tx+lock+reconcile) | P2B-J2 follow-up | LOW (non-blocking) | Medium | `POST /exams/:id/archive` currently calls `archiveExam` directly (no tx/lock/reconcile). Predates all slices; not a regression. A future job should wrap it for consistency with close/unpublish/extend/cancel. |
| 4 | Audit writes moved into the transaction (all admin ops) | P2B-J2 follow-up | LOW (repo convention) | Medium-Large | close/extend/unpublish/cancel + attempts.ts all write audit after the tx commits (best-effort, matching repo convention). The ADR construction hard rule describes the ideal order; a repo-wide change is out of scope for these slices. |

## E2E spec — item #1 detail

The spike `admin-flow.spec.ts` had 4 tests:

1. **publish lifecycle** (draft→published→archived via UI) — green.
2. **enrollment** (add candidate via picker → remove) — green.
3. **scores 409 guard + visibility** — rewritten to drive the **close button**
   (no `endingSoonSec` workaround). After close, scores visible.
4. **CSV export** — closes via admin API, then asserts CSV response.

To land it:

- Cherry-pick the spec + its `lib/seed.ts`/`lib/login.ts` helpers from spike
  `61ad5c9`.
- Confirm the 4 tests still match the final routes (close/cancel) and testids
  (`exam-detail-close-btn`, `exam-detail-status`, etc.).
- Run via `scripts/e2e/run.sh` against an **isolated** DB (`docker-compose.test
  .override.yml` remaps to host :5434 / project `exam-e2e-p2b`), never
  `exam-test-pg` on :5432.
- The `endingSoonSec` workaround must NOT remain (use the real close route).

## Conclusion

ADR-005's four slices **exceeded** the original P2B-J2 core goal
(close/archive/lifecycle/audit/scores/export). The single hard remaining item
for both job cards is **`admin-flow.spec.ts`**. The other three items are
optional/non-blocking (enrollment batch validation needs scope confirmation;
the two follow-ups are documented and low priority).
