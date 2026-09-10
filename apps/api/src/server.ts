import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "./plugins/cors.js";
import setupSecurity from "./plugins/security.js";
import authPlugin from "./plugins/auth.js";
import authzScopedPlugin from "./plugins/authz.js";
import dbPlugin from "./plugins/db.js";
import redisPlugin from "./plugins/redis.js";
import nowPlugin from "./plugins/now.js";
import heartbeatPlugin from "./plugins/heartbeat.js";
import deadlineScannerPlugin from "./plugins/deadlineScanner.js";
import emailPlugin from "./plugins/email.js";
import emailOutboxLoopPlugin from "./plugins/emailOutboxLoop.js";
import auditLifecyclePlugin from "./plugins/auditLifecycle.js";
import zodProviderPlugin from "./plugins/zodProvider.js";
import { setupErrorHandler } from "./plugins/errors.js";
import { registerStaticFrontend } from "./plugins/staticFrontend.js";
import apiSurfacePlugin from "./routes/apiSurface.js";
import { registerOpenApiDocs } from "./openapi/registerDocs.js";
import { loadRootEnv } from "./config/loadRootEnv.js";
import { getRuntimeConfig } from "./config/runtimeConfig.js";
import { REDACT_CONFIG } from "./lib/logRedaction.js";

loadRootEnv();

const { port, host } = getRuntimeConfig();

/** #351 shutdown budget term: grace for natural exit after app.close(). */
const BOUNDED_EXIT_ASSIST_MS = 2_000;

function registerShutdownSignals(app: ReturnType<typeof Fastify>) {
  let shutdownStarted = false;
  const close = async () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    try {
      app.auditWrites.stopAccepting();
      const closeResult = app.close().then(
        () => null,
        (error: unknown) => error,
      );
      const auditDrain = await app.drainAuditWrites();
      if (auditDrain.timedOut) {
        app.log.warn(
          {
            event: "audit.drain_timeout",
            pendingCount: auditDrain.pendingCount,
          },
          "Best-effort audit drain timed out; pending observations will be abandoned",
        );
      }
      const closeError = await closeResult;
      if (closeError) throw closeError;
    } catch (err: unknown) {
      app.log.error({ err }, "Graceful shutdown failed");
      process.exitCode = 1;
    }
    // Bounded exit assist (#351): after app.close() settles, work ABANDONED
    // by a bounded shutdown (e.g. an in-flight email send past the loop's
    // EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS budget) can still hold ref'ed
    // timers/sockets, so natural exit would wait for it — past the
    // container stop grace, turning a clean bounded shutdown into SIGKILL
    // (137). Give the event loop a short grace to drain naturally (the
    // normal clean path — regression-tested by server.shutdown.test.ts),
    // then log the remaining owners and exit with the settled code. This
    // is NOT the old unconditional process.exit(): it fires only after
    // graceful close has settled, it is bounded, and it names what it cuts.
    // INVARIANT: BOUNDED_EXIT_ASSIST_MS is a term of the #351 shutdown
    // budget contract (loop 8s + audit 10s + DB 10s + this 2s = 30s <
    // compose stop_grace_period 45s; enforced by
    // scripts/repository-contract/deployment-topology-contract.mjs).
    const assist = setTimeout(() => {
      app.log.warn(
        { activeResources: process.getActiveResourcesInfo() },
        `event loop still busy ${BOUNDED_EXIT_ASSIST_MS}ms after graceful close — exiting with settled code (abandoned background work cut off)`,
      );
      process.exit(process.exitCode ?? 0);
    }, BOUNDED_EXIT_ASSIST_MS);
    assist.unref();
  };
  const onSignal = () => {
    void close();
  };
  // INVARIANT: the signal listeners stay installed for the process's whole
  // lifetime. The `shutdownStarted` guard already makes re-entry a no-op;
  // removing the listeners mid-shutdown (as an earlier version did in an
  // onClose hook) would re-open the DEFAULT SIGTERM disposition for any
  // second signal — an instant exit 143 mid-graceful-close (#351).
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
}

/**
 * Entry point for the API server. Creates a Fastify instance, registers
 * all plugins (auth, DB, rate-limiting, etc.), mounts route modules,
 * serves static assets from `public/`, and starts listening.
 */
async function main() {
  const app = Fastify({ logger: { level: "info", redact: REDACT_CONFIG } });

  await app.register(fastifyCookie);
  await app.register(cors);
  setupSecurity(app);
  setupErrorHandler(app);
  await app.register(zodProviderPlugin);
  await app.register(dbPlugin);
  await app.register(auditLifecyclePlugin);
  await app.register(redisPlugin);
  await app.register(nowPlugin);
  await app.register(authPlugin);
  await app.register(authzScopedPlugin);
  await app.register(heartbeatPlugin);
  await app.register(deadlineScannerPlugin);
  await app.register(emailPlugin);
  await app.register(emailOutboxLoopPlugin);

  await registerOpenApiDocs(app);

  // The whole /api namespace lives in one encapsulated scope: registered
  // routes, the liveness probe, the rate limiter, and the canonical
  // unmatched-request JSON boundary (#429). Fastify owns all routing
  // semantics for it; docs/static never enter the limiter.
  await app.register(apiSurfacePlugin, { prefix: "/api" });

  const publicDir = resolve(
    fileURLToPath(new URL("../public", import.meta.url)),
  );
  app.log.info({ publicDir, exists: existsSync(publicDir) }, "static dir");
  if (existsSync(publicDir)) {
    await registerStaticFrontend(app, publicDir);
  }

  registerShutdownSignals(app);
  await app.listen({ port, host });
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
