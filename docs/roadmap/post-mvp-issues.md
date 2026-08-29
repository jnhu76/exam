# Post-MVP Work Index

> This is a coarse navigation index only. GitHub is authoritative for live
> open/closed state, and Issue
> [#333](https://github.com/jnhu76/exam/issues/333) is the current sequencing
> and disposition authority. Do not duplicate an Issue specification here.

## Program / convergence

- #320 Dedicated email-worker process boundary — bounded KEEP vs CONVERGE decision.
- #333 Generic completion → stabilization → High-Assurance / ToB roadmap tracker.

## Generic product completion

- #297 Staff invitation + Email password reset + account lifecycle.
- #298 Permission registry + permission audit + audit-log search/export UI.
- #299 Additional operational notifications.
- #300 Email template engine + backend i18n.
- #301 Rich-text / WYSIWYG V1.
- #291 Additional exam timing modes — generic Phase A plus later high-assurance portion.
- #294 Question / option randomization.

Teacher→Course (#286) and Grader→Exam (#296) are completed scoped-role slices
and are intentionally not listed as future work. The former final-answer submit
barrier tracker #302 is closed and likewise not part of the executable queue.

## Stabilization / product quality

- #341 Deterministic Simulation Testing experiment for attempt lifecycle races.
- #305 UI design-system migration completion.
- #306 Responsive closeout — Candidate-first baseline.
- #307 Accessibility closeout.
- #308 Long-text answer + metadata/definition-list components.

## High-Assurance exam capabilities

These are deferred from the generic-release path but remain committed work:

- #292 Operational admission queue.
- #293 Controlled / Strict high-assurance readiness umbrella.
- #303 Proctor Recovery Center.
- #304 System-generated incidents.
- #315 Device/session binding runtime.
- #316 Secondary identity verification.
- #317 Continuous monitoring policy/runtime.
- the `timed_sync` portion of #291.

## ToB integration / platformization

Scheduled only after the generic edition is completed and stabilized:

- #309 Pass-to-proceed API + service tokens / API keys.
- #310 Signed, retryable, audited webhooks.
- #312 External log shipping.
- #313 Custom roles from the capability catalog.
- #311 Multi-tenant platformization and isolation model.

## Decision-gated work

- #295 Managed desktop / lockdown runtime adoption.
- #311 Multi-tenant adoption requires its scale/isolation decision before implementation.
- #313 Custom-role generalization remains evidence-gated even though it is scheduled future work.

Redis responsibilities beyond the accepted shared baseline remain subject to the
relevant ADR decision gates. A roadmap summary never turns a decision-gated
idea into implementation authority.

## Usage rule

When selecting work:

1. read #333 for the current lane and ordering;
2. open the selected Issue and treat its current body/checkpoints as the task
   contract;
3. reconcile that contract with current master before editing;
4. update the Issue when scope, root cause, contract, or disposition changes;
5. use this file only to navigate the portfolio, never to infer live Issue
   state.