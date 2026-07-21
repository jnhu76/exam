import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

export const AUDIT_DRAIN_TIMEOUT_MS = 10_000;

export interface AuditDrainResult {
  timedOut: boolean;
  pendingCount: number;
}

export class AuditDrainTimeoutError extends Error {
  constructor(pendingCount: number, timeoutMs: number) {
    super(
      `Audit drain timed out after ${timeoutMs}ms with ${pendingCount} pending tasks`,
    );
    this.name = "AuditDrainTimeoutError";
  }
}

export class AuditWriteRejectedError extends Error {
  constructor() {
    super("Audit lifecycle no longer accepts best-effort work");
    this.name = "AuditWriteRejectedError";
  }
}

export interface AuditWriteLifecycle {
  schedule(
    task: () => Promise<void>,
    onRejected: (error: unknown) => void,
  ): void;
  drain(options?: { timeoutMs?: number }): Promise<AuditDrainResult>;
  drainStrict(options?: { timeoutMs?: number }): Promise<void>;
  pendingCount(): number;
  isDraining(): boolean;
  isAccepting(): boolean;
  stopAccepting(): void;
}

declare module "fastify" {
  interface FastifyInstance {
    auditWrites: AuditWriteLifecycle;
    drainAuditWrites(): Promise<AuditDrainResult>;
    drainAuditWritesStrict(): Promise<void>;
  }
}

export function createAuditWriteLifecycle(): AuditWriteLifecycle {
  const pending = new Set<Promise<void>>();
  let activeDrain: Promise<AuditDrainResult> | null = null;
  let terminalDrainResult: AuditDrainResult | null = null;
  let accepting = true;

  const drainPending = async () => {
    while (pending.size > 0) {
      await Promise.all([...pending]);
    }
  };

  const drain = (options?: {
    timeoutMs?: number;
  }): Promise<AuditDrainResult> => {
    if (terminalDrainResult) {
      return Promise.resolve(terminalDrainResult);
    }
    if (activeDrain) return activeDrain;
    const timeoutMs = options?.timeoutMs ?? AUDIT_DRAIN_TIMEOUT_MS;
    activeDrain = new Promise<AuditDrainResult>((resolve) => {
      const timeout = setTimeout(() => {
        accepting = false;
        resolve({ timedOut: true, pendingCount: pending.size });
      }, timeoutMs);
      timeout.unref?.();

      void drainPending().then(() => {
        clearTimeout(timeout);
        resolve({ timedOut: false, pendingCount: 0 });
      });
    })
      .then((result) => {
        if (!accepting) terminalDrainResult = result;
        return result;
      })
      .finally(() => {
        activeDrain = null;
      });
    return activeDrain;
  };

  return {
    schedule(task, onRejected) {
      if (!accepting) {
        try {
          onRejected(new AuditWriteRejectedError());
        } catch (observerError) {
          void observerError;
        }
        return;
      }
      let tracked!: Promise<void>;
      tracked = Promise.resolve()
        .then(task)
        .catch((error: unknown) => {
          try {
            onRejected(error);
          } catch (observerError) {
            void observerError;
          }
        })
        .finally(() => {
          pending.delete(tracked);
        });
      pending.add(tracked);
    },
    drain,
    async drainStrict(options) {
      const result = await drain(options);
      if (result.timedOut) {
        throw new AuditDrainTimeoutError(
          result.pendingCount,
          options?.timeoutMs ?? AUDIT_DRAIN_TIMEOUT_MS,
        );
      }
    },
    pendingCount() {
      return pending.size;
    },
    isDraining() {
      return activeDrain !== null;
    },
    isAccepting() {
      return accepting;
    },
    stopAccepting() {
      accepting = false;
    },
  };
}

interface AuditLifecyclePluginOptions {
  drainTimeoutMs?: number;
}

const auditLifecyclePlugin: FastifyPluginAsync<
  AuditLifecyclePluginOptions
> = async (fastify, options) => {
  const lifecycle = createAuditWriteLifecycle();
  fastify.decorate("auditWrites", lifecycle);
  fastify.decorate("drainAuditWrites", async () => {
    return lifecycle.drain({
      timeoutMs: options.drainTimeoutMs ?? AUDIT_DRAIN_TIMEOUT_MS,
    });
  });
  fastify.decorate("drainAuditWritesStrict", async () => {
    await lifecycle.drainStrict({
      timeoutMs: options.drainTimeoutMs ?? AUDIT_DRAIN_TIMEOUT_MS,
    });
  });
  fastify.addHook("onClose", async () => {
    lifecycle.stopAccepting();
    await fastify.drainAuditWrites();
  });
};

export default fp(auditLifecyclePlugin, { name: "auditLifecyclePlugin" });
