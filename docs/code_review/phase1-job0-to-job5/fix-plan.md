# Phase 1 Job 0-5 Fix Plan

## Batch 1: Authentication and API Baseline

- RF-001, RF-002, RF-010, RF-013, RF-014, RF-016, RF-017, RF-024
- Add tenant-aware login, active-user checks, secure bootstrap behavior, typed request context, unified errors, and session restoration.

## Batch 2: Exam and Question Integrity

- RF-005, RF-006, RF-007, RF-008, RF-020, RF-021, RF-023
- Tighten contracts and domain commands, validate scoped relations, protect imports, and use state-machine commands.

## Batch 3: Candidate and Database Integrity

- RF-004, RF-018
- Enforce CandidateField identity rules, add candidate update paths, and add database uniqueness constraints.

## Batch 4: Admin Workflows and Branding

- RF-003, RF-011, RF-012, RF-019
- Complete required management interactions, runtime branding reads, and import confirmation behavior.

## Batch 5: Evidence and Quality Gates

- RF-009, RF-015, RF-022
- Replace placeholder gates, wire sensitive audit logs, improve test assembly, and run verification.
