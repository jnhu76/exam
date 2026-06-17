import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

/**
 * A function that returns the current `Date`. Defaults to `new Date()` but
 * can be overridden for testing or deterministic time control.
 */
export type NowProvider = () => Date;

declare module "fastify" {
  interface FastifyInstance {
    now: NowProvider;
    setNowOverride(provider: NowProvider | null): void;
  }
}

/**
 * Fastify plugin that decorates the instance with a `now` time provider
 * and a `setNowOverride` function. When an override is set, `now()` returns
 * the override's result instead of `new Date()`. Useful for tests and
 * deterministic exam timer behavior.
 */
const nowPlugin: FastifyPluginAsync = async (fastify) => {
  let override: NowProvider | null = null;
  fastify.decorate<NowProvider>("now", () =>
    override ? override() : new Date(),
  );
  fastify.decorate("setNowOverride", (provider: NowProvider | null) => {
    override = provider;
  });
};

export default fp(nowPlugin);
