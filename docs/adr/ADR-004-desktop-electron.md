# ADR-004 — Desktop / Electron Exam Runtime

## Status

**DEFERRED**

No Desktop/Electron exam runtime has been adopted or implemented.

## Current binding decision

The product remains a server-authoritative web exam system. A privileged
Desktop/Electron client is **not** a current runtime dependency and is not
required for the normal web exam path.

The following rules are binding while this ADR remains Deferred:

1. **Do not implement or require Electron merely because `requireLockdown`
   exists in the exam policy shape.** That flag is currently latent/unenforced;
   its presence is not Desktop adoption.
2. **Do not create a second exam protocol.** Any future Desktop client must
   consume the then-current accepted server-side exam/save/submit/time/recovery
   contracts rather than fork them.
3. **Server/PostgreSQL authority remains unchanged.** Desktop must never become
   the durable truth for attempts, answers, grading, results, incidents, audit,
   or exam lifecycle.
4. **A future local answer store is recovery state, not a second truth source.**
   Its conflict/replay semantics require a separate current review.
5. **Desktop remains optional unless a later accepted deployment decision says
   otherwise.** Building an optional client and requiring it for a particular
   deployment are separate decisions.
6. **Future adoption requires a fresh security review.** Privileged main-process
   capabilities, preload/IPC, local answer material, signing/update, endpoint
   trust, and lockdown controls must be reviewed against the actual technology
   and threat model chosen at adoption time.

## Current reality

Repository review still shows Electron/Desktop as documentation/future scope,
not an implemented runtime. `requireLockdown` exists in contracts/policy data,
but current policy documentation explicitly classifies it among latent,
unenforced control flags.

Therefore:

```text
Desktop/Electron runtime     NOT IMPLEMENTED
requireLockdown field        PRESENT, LATENT / UNENFORCED
Desktop protocol authority   NONE
Desktop local-data authority NONE
ADR-004 status               DEFERRED
```

Browser-side controls such as tab-switch detection or copy/paste restrictions
do **not** count as implementation of this ADR. They are ordinary web-client
behaviors and cannot provide the OS-level authority implied by a privileged
lockdown client.

## Why Desktop may eventually be considered

A browser cannot reliably enforce every closed-book/kiosk restriction. A
Desktop runtime becomes a legitimate candidate only when a real deployment has
a requirement that the browser path cannot responsibly satisfy.

Examples of triggers:

| Trigger | Why a privileged client may be relevant |
| --- | --- |
| Enforced kiosk/lockdown behavior is a deployment requirement | OS-level/window/process controls are outside a normal web page's authority |
| A managed single-purpose exam device is required | The exam client becomes part of the controlled device runtime rather than one browser tab |
| Offline-resilient local persistence beyond the accepted browser model is required | A privileged local store may offer different durability/recovery capabilities, but needs its own semantics/security review |

A trigger means **perform an adoption review**. It does not mean "use Electron".
Electron, Tauri, a managed browser/kiosk runtime, or another mechanism must be
compared against the actual requirement at that time.

## Future adoption gate

Before implementation begins, a follow-up accepted decision must define at
least:

- the concrete deployment requirement and why the browser path is insufficient;
- selected runtime technology and platform support matrix;
- whether the client is optional globally and/or required by specific
  deployment/exam policy;
- server protocol reuse and compatibility contract;
- local-data/recovery authority and conflict semantics, if any;
- lockdown capability and known bypass limits;
- preload/IPC or equivalent privilege boundary;
- endpoint/server trust and certificate/configuration model;
- code signing, update, downgrade, and distribution policy;
- crash/restart/recovery behavior during an active attempt;
- deterministic E2E/security test strategy;
- rollback and migration behavior.

No implementation spike should silently decide these semantics first and ask the
ADR to catch up later.

## Relationship to other decisions

Future Desktop adoption must **re-audit current authority at adoption time**.
The original Phase-2 assumptions are not frozen interfaces forever.

At minimum, review the then-current accepted decisions/contracts for:

- **Exam lifecycle/state authority** — the Desktop client consumes server
  lifecycle semantics; it does not define them.
- **Exam time authority (ADR-006)** — local clocks/countdowns are projections;
  the accepted server time/deadline model remains authoritative unless
  explicitly amended.
- **Submit/save freeze semantics (ADR-008 and current submit authority)** —
  local caching/replay must not bypass serialization/freeze boundaries.
- **Candidate recovery (ADR-012 and later accepted recovery decisions)** — a
  Desktop cache cannot invent a competing recovery protocol.
- **Offline-resilient client direction (ADR-016)** — Desktop and offline
  resilience overlap but are not the same decision; adoption of one does not
  implicitly accept the other.
- **Scoped authorization** — privileged client capabilities do not grant server
  business authorization.

These are cross-references/adoption constraints, not an assertion that ADR-004
currently depends on every listed ADR for runtime behavior; ADR-004 is Deferred.

## Hard constraints for any future Desktop design

Unless explicitly changed by a later accepted decision:

1. **Server business commands remain authoritative.** Desktop reuses accepted
   save, heartbeat/recovery, submit, and state-transition APIs/commands.
2. **No local durable business truth.** Local data may assist recovery but must
   have an explicit reconciliation contract with server authority.
3. **No hidden cloud dependency.** The deployment remains compatible with the
   project's on-premise/LAN requirements unless architecture authority changes.
4. **Least privilege.** Renderer/UI code must not receive arbitrary privileged
   host capabilities; any bridge is narrow and auditable.
5. **Security properties must be stated truthfully.** "Lockdown" is
   defense-in-depth, not proof that a determined user cannot bypass the host OS.
6. **Web compatibility is deliberate.** If a deployment later requires the
   privileged client, the accepted decision must say where/why; do not let an
   implementation accident silently disable the web path.

## Failure / security questions for a future adoption

The follow-up design must answer rather than inherit old Phase-2 prose:

- What happens when the server is unreachable during an attempt?
- Which local writes are durable, and when are they replayed?
- How are server/local version conflicts surfaced and resolved?
- What happens at the authoritative deadline while the client is offline?
- How does crash/relaunch restore the current attempt?
- How are answer files/cache encrypted or access-restricted and later cleared?
- How is the intended server authenticated to the client?
- How are binaries/updates signed and downgrade attacks handled?
- What privileged APIs exist, and how are they exposed to renderer content?
- Which lockdown guarantees are enforceable per OS, and which are only
  best-effort?

## Rollback principle

Because no Desktop runtime is currently adopted, there is no current runtime
rollback procedure beyond keeping the web path authoritative.

A future adoption decision must define rollback for its own deployment model,
including treatment of local in-flight recovery data and any exam policy that
requires the privileged client. It must not assume that disabling a client is
safe if candidates or un-reconciled local data are active.

## Historical context — Phase 2 acceptance-time baseline

> **NON-NORMATIVE CURRENT REALITY.** Phase 2 recorded this ADR specifically to
> prevent speculative Electron work. At that time the project described an
> `apps/desktop/` reservation, a future `requireLockdown` capability, and a
> browser/server protocol baseline. Those facts explain the original decision
> but are not a frozen specification for a future Desktop implementation.

The durable conclusion from that period remains valid: Desktop should be
introduced only for a concrete deployment requirement, after an explicit
architecture and security review, and without creating a second source of exam
truth.

## Current disposition

```text
Desktop/Electron implementation     DEFERRED
Concrete adoption trigger           NOT DEMONSTRATED / NOT ACCEPTED
requireLockdown runtime enforcement NOT IMPLEMENTED
Second exam protocol                FORBIDDEN WITHOUT EXPLICIT REDESIGN
Local answer truth                  NOT ADOPTED
Future Desktop technology           UNDECIDED
```
