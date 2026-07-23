# ADR-004 — Desktop / Electron Exam Runtime

## Status

Deferred

## Context

The exam platform runs today as a web application: candidates take exams in a browser, with answers saved to the server via the Answer Save Protocol (HTTP POST, versioned, idempotent), a server-side timer as time authority, and a server-side heartbeat that detects disconnection.

For strict closed-book / proctored exam scenarios, a browser is not always sufficient. Lockdown — restricting clipboard, screen capture, application switching, and other-tab access — cannot be reliably enforced from a web page. `controlFlags.requireLockdown` exists in the schema (SPEC §2.6) and is explicitly a future capability; Phase 1 does not implement Electron lockdown.

The project structure reserves `apps/desktop/` for an Electron shell (SPEC), but it is **not started**. The Phase 2 plan (§9 Future Phase — Desktop Exam Runtime) states plainly: Desktop/Electron implementation is **not** part of Phase 2; Phase 2 only records the ADR. The roadmap defers Electron lockdown to a future phase, and Phase 2 explicitly does not implement Electron lockdown (plan §11, non-goals).

This ADR records what problem Desktop would solve, why it is deferred, the scope a future implementation may consider, and the hard constraints it must obey — so a future team cannot start a Desktop spike without first reading this decision.

## Decision

**Desktop/Electron implementation is deferred. Phase 2 only records this ADR.**

No `apps/desktop/` code is written in Phase 2. `controlFlags.requireLockdown` remains schema-only and unused by any runtime path. Any future Desktop implementation requires a follow-up decision recorded against this ADR, and must obey the constraints in this document.

## Triggers for Adoption

A Desktop runtime becomes a candidate **only** when at least one of the following is concretely required by a real deployment, not as a feature check-list:

| Trigger | Why Desktop | Ref |
| ------- | ----------- | --- |
| A deployment requires enforced lockdown (clipboard, screen capture, tab/app switching) that a browser cannot guarantee | Only a desktop shell with OS-level restrictions can enforce closed-book behavior reliably. | SPEC §6, §9 |
| A deployment needs a kiosk / single-purpose exam device experience | A locked-down desktop client is the runtime, not a tab among many. | SPEC §9 |
| A deployment needs offline-resilient answer caching beyond the browser | Browser storage is unreliable for proctored exams; a local desktop cache with defined sync rules may be needed. | plan §9 |

Each trigger must be tied to a real requirement from a real deployment. "Lockdown would be nice" is not a trigger.

## Non-Goals

- Phase 2 implementation. Desktop is deferred; Phase 2 records this ADR only.
- Camera / screen proctoring, AI proctoring. Those are separate concerns, out of scope here and in Phase 2.
- A second exam protocol. Desktop must reuse the server-side exam protocol (see Constraints).
- A required runtime component. Desktop, if built, is an **optional** client. The web exam path must remain fully functional.

## Future Desktop Scope (illustrative)

If adopted, a Desktop runtime **may** include — this list is descriptive, not a commitment:

- **Electron shell** wrapping the existing web exam UI (`apps/desktop/`), not a separate application.
- **Secure preload / IPC boundary** — a minimal, audited bridge between the renderer and main process; no arbitrary Node APIs exposed to the page.
- **Lockdown mode** — restrict clipboard, screen capture, tab/application switching, and external links while an exam is in progress; released on submit.
- **Local answer cache** for offline resilience — a bounded cache used only to recover from transient connectivity loss, never as the truth.
- **Endpoint discovery for LAN server** — discover/configure the exam server URL on the local network.
- **Auto-update and code signing** — signed updates with verification; no unsigned code execution.
- **Device diagnostics reporting** — collect minimal environment info to support incident diagnosis, with candidate consent where required.

The exact scope must be pinned in the follow-up decision; this list exists to bound expectations.

## Hard Constraints

These are mandatory for any future Desktop implementation, non-negotiable:

1. **Reuse the server-side exam protocol.** Desktop uses the same Answer Save Protocol (versioned, idempotent POSTs), the same server-side timer as time authority, the same heartbeat, and the same submit path. The server's exam-engine and command functions are the single authority for state transitions.
2. **No second answer-save truth source.** The local answer cache (if any) is a **recovery cache**, never the system of record. PostgreSQL on the server is always the source of truth. Conflicts resolve in favor of the server's versioned save protocol.
3. **PostgreSQL / server remains the single source of truth.** Attempt state, grading, results, audit — all server-owned. Desktop never mutates authoritative state locally.
4. **Desktop is an optional client.** The web exam path (`TakeExamPage`, Answer Save Protocol, submit) must keep working without Desktop. `requireLockdown`, if honored, is enforced per-deployment; it must not make Desktop the only way to take an exam unless a deployment explicitly chooses that.
5. **LAN / on-premise only.** Desktop connects to the on-premise server; no cloud dependency, no telemetry, no online-only behavior. Code signing keys are managed on-premise.
6. **Security review before spike.** Because lockdown and local caching touch sensitive surfaces, a security review of the preload/IPC boundary and the cache is required before any implementation.

## Operational Burden

- **A new build target** — Electron binaries per OS, code signing certificates, update infrastructure. This is the largest single new burden in this ADR set.
- **Distribution / update mechanism** — how candidates get the client and how it updates securely; signing key management.
- **Platform matrix** — Windows / macOS / Linux behavior differences (especially lockdown primitives).
- **Local cache integrity** — cache corruption, partial writes, and cache-vs-server reconciliation logic must be designed and tested.
- **Security surface** — the preload/IPC bridge and lockdown hooks are privileged; any bug is a security issue in a proctored exam.
- **Test complexity** — lockdown and offline-resilience scenarios are hard to test deterministically; an Electron E2E matrix is required.

## Failure Modes

- **Server unreachable during an exam (Desktop).** The local answer cache buffers saves; on reconnect, the Answer Save Protocol reconciles (versioned, idempotent). If the exam cannot submit by deadline, the server-side deadline scanner (P2A-J2) handles auto-submit from server state — Desktop does not invent a fallback.
- **Cache / server conflict.** Resolved by the server's versioned save protocol; the server wins. Desktop must surface the conflict to the candidate, not silently choose.
- **Lockdown bypass / tampering.** Treated as a security incident. Lockdown is best-effort enforcement layered on top of server authority; it cannot be the only thing protecting exam integrity.
- **Unsigned / stale client.** The client must refuse to run unsigned code or connect to an unconfigured endpoint; no silent fallback to an attacker-controlled server.
- **Client crash mid-exam.** Recovery is identical to the web path: on relaunch, `restoreAttempt` (P2A-J5) restores answers + remaining time from the server.

## Security Considerations

- **Lockdown is defense-in-depth, not a guarantee.** Determined adversaries can bypass OS-level restrictions. Exam integrity ultimately rests on server-side controls (time authority, server-owned state, audit). Desktop lockdown raises the bar; it does not replace server authority.
- **Preload / IPC minimalism.** Only the exact capabilities needed are exposed to the renderer; `nodeIntegration` off, `contextIsolation` on. Every IPC channel is audited.
- **Local cache protection.** The cache contains answer data; it must be stored with access restricted to the exam user and cleared after submit/timeout per policy.
- **No new network egress.** Desktop talks only to the configured LAN server. No update/telemetry endpoints outside the on-premise update infrastructure.
- **Code signing.** Updates must be signed and verified; downgrade attacks must be rejected.

## Rollback Plan

1. Because Desktop is an optional client, rollback is per-deployment: stop distributing/requiring the client; candidates fall back to the web exam path.
2. No server-side data reconciliation is needed — Desktop never owned the truth. All attempts, answers, grades, and audit records are server-side.
3. Disable `requireLockdown` enforcement (it is a per-deployment control flag); the web path is unaffected.
4. Remove the Desktop client from distribution; retire the update/signing infrastructure.
5. Update this ADR to record why adoption was rolled back.

Rollback is safe because Desktop is optional and the server is always the source of truth.

## Phase 2 Decision

**Desktop/Electron implementation is deferred. Phase 2 only records this ADR.**

- `apps/desktop/` remains not-started.
- `controlFlags.requireLockdown` stays schema-only; no runtime path enforces it in Phase 2.
- Any future Desktop implementation requires (a) a documented, deployment-backed trigger, (b) a follow-up decision updating this ADR, (c) adherence to the hard constraints (reuse server protocol, no second truth source, server = source of truth, optional client, LAN-only), and (d) a security review of the preload/IPC and cache surfaces before any spike.
