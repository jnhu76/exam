# Post-MVP Work Index

> This is a coarse navigation index only. GitHub is authoritative for live
> open/closed state. The current sequencing and disposition authority is
> [#552](https://github.com/jnhu76/exam/issues/552). Do not duplicate an Issue
> specification here.

## Program / convergence

- #552 Generic Production Hardening roadmap — **CURRENT EXECUTION AUTHORITY**.
- #516 Generic Runtime Completion — completed historical phase boundary.
- #320 Dedicated email-worker process boundary — bounded KEEP vs CONVERGE decision.

## Generic product completion

- #297 Staff invitation + Email password reset + account lifecycle.
- #298 Permission registry + permission audit + audit-log search/export UI.
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

High-Assurance is the next major capability phase **after #552 closes**. It is
not the current execution lane. The remaining High-Assurance-specific runtime
sequence is:

- #315 Device/session binding runtime.
- #316 Secondary identity verification.
- #317 Continuous monitoring policy/runtime.
- #293 Controlled / Strict high-assurance readiness umbrella and final composition.

Completed generic-runtime foundations such as #292 (durable operational
admission), #303 (Proctor Recovery Center), and #304 (System-generated
incidents) are historical prerequisites, not remaining High-Assurance work.
#294 randomization is independent capability evidence and is not a substitute
for #315/#316/#317.

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

1. read the live tracker (#552) for the current lane and ordering;
2. open the selected Issue and treat its current body/checkpoints as the task
   contract;
3. reconcile that contract with current master before editing;
4. update the Issue when scope, root cause, contract, or disposition changes;
5. use this file only to navigate the portfolio, never to infer live Issue
   state.
