import type { FastifyReply, FastifyRequest } from "fastify";
import type { AttemptCommandDisposition } from "@exam/contracts";
import type { GrantOutcome } from "@exam/exam-engine";

/**
 * W07 (#1008 / E07) — owner-local typed emission boundary for the two admin
 * attempt commands (`force_submit`, `time_grant`). One bounded owner owns the
 * closed vocabularies, the field whitelist, the identity source, the emission
 * conditions, and the failure isolation (#1001 decision A: no central
 * observability package, no event bus).
 *
 * Semantics (commit-authoritative):
 *  - `admin.command.completed` is emitted ONLY by the route, AFTER the full
 *    race-recovery wrapper resolved successfully and BEFORE the response
 *    schema parse, from the wrapper's own verified disposition / outcome.
 *    It is never emitted inside a transaction callback (a callback return is
 *    not a commit), never reconstructed from the HTTP status or the receipt
 *    history, and never derived from a test-only observer.
 *  - `admin.command.denied` is emitted at most once per request, from a
 *    route-scoped onResponse hook (#1008 W07), only for 403/404/409 — the
 *    exits that prove this request did NOT commit a business fact. 400/401/
 *    500/503 keep their existing owners and stay silent here.
 *
 * Identity: emitted through `request.log`, whose Pino `reqId` binding IS the
 * server-minted `request.id` (ADR-025) — the same value as the error
 * envelope, the `x-request-id` header, and the request trace. No duplicate
 * requestId field is added.
 *
 * INVARIANT (payload whitelist): fields are constructed here from closed
 * unions, never spread from request/ctx/receipt/result/error. Denial lines
 * deliberately carry NO target attemptId/operationId/reason/permission
 * relation/error details — the Admin identity does not license logging the
 * specifics of a denied target, and the anti-enumeration 404 must stay one
 * uniform value (never a private "actually cross-org" classification).
 */

/** The two in-scope admin attempt commands (#1008 scope; misconduct excluded). */
export type AdminCommandName = "force_submit" | "time_grant";

/** Top-level final-outcome vocabulary for `admin.command.completed`. */
export type AdminCommandCompletedOutcome = "applied" | "replay_no_change";

/** Outcome vocabulary for `admin.command.denied`. */
export type AdminCommandDeniedOutcome = "forbidden" | "not_found" | "conflict";

export const ADMIN_COMMAND_COMPLETED_MSG = "admin.command.completed";
export const ADMIN_COMMAND_DENIED_MSG = "admin.command.denied";

/**
 * Failure isolation boundary: field construction and the synchronous logger
 * call run inside one small boundary that swallows a synchronous sink
 * failure. A logging failure must never flip a committed command into an
 * HTTP error or alter the response (same fail-open contract as the
 * transaction retry logger, `packages/db` #1006 D4). This does NOT claim
 * coverage of asynchronous stream EPIPE/backpressure — those stay with the
 * host's existing stream handling.
 */
function safeEmit(
  request: FastifyRequest,
  fields: Record<string, string>,
  msg: string,
): void {
  try {
    request.log.info(fields, msg);
  } catch {
    // INTENTIONAL: isolated single-point swallow (see doclet). No recursive
    // logging of the logging failure.
  }
}

/**
 * Maps the force-submit wire disposition (returned by the verified wrapper:
 * first execution `applied`/`no_change`, replay `idempotent_replay` with the
 * ORIGINAL stored outcome) to the log vocabulary. Exhaustive switch over the
 * real union — a new disposition value fails compilation here instead of
 * silently defaulting to `applied`.
 */
function forceSubmitOutcome(
  disposition: AttemptCommandDisposition,
): AdminCommandCompletedOutcome {
  switch (disposition) {
    case "applied":
      return "applied";
    case "no_change":
    case "idempotent_replay":
      return "replay_no_change";
  }
}

/**
 * Emits `admin.command.completed` for a force-submit whose full
 * race-recovery wrapper resolved successfully. `disposition` is the wire
 * disposition of the returned receipt — the already-verified authority; no
 * new business query, transaction, or audit callback is introduced for the
 * log.
 */
export function emitForceSubmitCommandCompleted(
  request: FastifyRequest,
  outcome: {
    attemptId: string;
    operationId: string;
    disposition: AttemptCommandDisposition;
  },
): void {
  safeEmit(
    request,
    {
      command: "force_submit",
      outcome: forceSubmitOutcome(outcome.disposition),
      disposition: outcome.disposition,
      attemptId: outcome.attemptId,
      operationId: outcome.operationId,
    },
    ADMIN_COMMAND_COMPLETED_MSG,
  );
}

/**
 * Maps the engine time-grant outcome to the log vocabulary. The real union is
 * `granted | terminal | idempotent_replay` — there is no `no_change` value
 * (#1008 field-mapping note: the design table's `no_change` row is
 * unreachable as-built; `terminal` — reconciliation terminalization with no
 * ledger write — is the actual third value and must NOT be flattened into
 * `applied`). Exhaustive switch: a new engine value fails compilation.
 */
function timeGrantOutcome(outcome: GrantOutcome): AdminCommandCompletedOutcome {
  switch (outcome) {
    case "granted":
      return "applied";
    case "terminal":
    case "idempotent_replay":
      return "replay_no_change";
  }
}

/**
 * Emits `admin.command.completed` for a time grant whose full race-recovery
 * wrapper resolved successfully. `outcome` is the engine outcome of the
 * wrapper's authoritative return.
 */
export function emitTimeGrantCommandCompleted(
  request: FastifyRequest,
  result: {
    attemptId: string;
    operationId: string;
    outcome: GrantOutcome;
  },
): void {
  safeEmit(
    request,
    {
      command: "time_grant",
      outcome: timeGrantOutcome(result.outcome),
      disposition: result.outcome,
      attemptId: result.attemptId,
      operationId: result.operationId,
    },
    ADMIN_COMMAND_COMPLETED_MSG,
  );
}

/**
 * Route-scoped `admin.command.denied` onResponse hook factory. The command is
 * a registration-time constant of the route — never inferred from the URL.
 *
 * WHY onResponse: the 403/404 denials of these routes exit from the
 * scoped-capability preHandler via `reply.send` (the handler never runs), so
 * a handler-side catch cannot see them; 409 exits via a throw into the
 * global error handler. The hook observes every exit exactly once. It cannot
 * misrecord a committed outcome: after the wrapper resolves successfully the
 * only remaining failures are the response schema parse (400) and response
 * serialization (500) — both outside {403,404,409} — and completed is only
 * emitted on the success path, so the two events are mutually exclusive.
 */
export function adminCommandDeniedOnResponse(command: AdminCommandName) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    let denied: AdminCommandDeniedOutcome;
    switch (reply.statusCode) {
      case 403:
        denied = "forbidden";
        break;
      case 404:
        denied = "not_found";
        break;
      case 409:
        denied = "conflict";
        break;
      default:
        return;
    }
    safeEmit(request, { command, outcome: denied }, ADMIN_COMMAND_DENIED_MSG);
  };
}
