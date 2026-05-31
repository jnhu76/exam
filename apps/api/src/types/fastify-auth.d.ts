import "fastify";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
    requireRole: (
      roles: string[],
    ) => (request: any, reply: any) => Promise<void>;
  }
}
