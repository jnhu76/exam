import type { FastifyInstance } from "fastify";

/**
 * #865 (scope 865-C): stamps the server-owned `x-request-id` response header
 * on every Fastify-managed response — the fourth request-correlation carrier,
 * reusing the ADR-025 `request.id` (UUIDv4 via `genReqId`, with
 * `requestIdHeader: false` keeping client headers non-influential). No second
 * id is minted: the header makes the id that already keys the pino log lines
 * and the error envelope readable by the caller on SUCCESS paths too.
 *
 * OWNERSHIP: registered once at ROOT scope in server.ts. Deliberately a plain
 * function (setupSecurity/setupErrorHandler pattern), not an encapsulated
 * plugin — a plugin registered as a sibling scope would leave every other
 * sibling (and the root's own 404 boundary) without the header.
 *
 * Requests that can NEVER carry the header are a documented boundary, not a
 * defect (docs/contracts/observability.md): replies never sent (connection
 * destroyed mid-request), socket-level HTTP framing failures, and Node-level
 * request/keepAlive timeouts — Fastify never reaches a reply for those.
 */
export function setupRequestIdHeader(app: FastifyInstance): void {
  // onRequest is the earliest hook that has both the request id (minted by
  // genReqId before hooks run) and the reply; setting the header here covers
  // every downstream status path, including the unified error handler.
  //
  // PROTOCOL (fastify lifecycle): this hook MUST either be async or call
  // `done()` — a synchronous hook that returns undefined stalls the hook
  // runner, which cannot distinguish "finished" from "will call done later",
  // and the request never gets a response. The done-callback form keeps the
  // hook fully synchronous (no per-request promise allocation).
  app.addHook("onRequest", (request, reply, done) => {
    reply.header("x-request-id", request.id);
    done();
  });
}
