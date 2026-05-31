import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { RequestContext } from "@exam/domain";

const tenantPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", async (request, reply) => {
    // TODO: 实现多租户逻辑
    // 对于 SuperAdmin 用户，需要支持跨组织访问
    // 对于其他用户，只允许访问自己组织的数据
  });
};

export default fp(tenantPlugin);
