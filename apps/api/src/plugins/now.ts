import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

export type NowProvider = () => Date;

declare module "fastify" {
  interface FastifyInstance {
    now: NowProvider;
    setNowOverride(provider: NowProvider | null): void;
  }
}

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
