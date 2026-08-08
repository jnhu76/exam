import { createHmac } from "node:crypto";
import type { FastifyRequest } from "fastify";

/**
 * Domain-separation context for the rate-limit IP digest (P7). The digest is
 * HMAC-SHA256 over `exam-ratelimit-ip-v1:<ip>` with the deployment JWT secret
 * as the key, so the same secret never signs rate-limit material with any
 * other domain. See docs/audits/P7-REDIS-SHARED-RATE-LIMIT-CLOSEOUT.md §key.
 */
const RATE_LIMIT_DIGEST_CONTEXT = "exam-ratelimit-ip-v1";

/**
 * Stable opaque digest of a client IP. Used as the shared rate-limit key so
 * raw IP text never enters the Redis keyspace (P7 §13). Deterministic across
 * API instances that share the deployment secret, which is what makes the
 * shared limiter count one total across processes.
 */
export function createIpDigest(ip: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${RATE_LIMIT_DIGEST_CONTEXT}:${ip}`)
    .digest("hex");
}

/**
 * Rate-limit key generator for the plugin: a stable opaque digest of
 * `request.ip`. The raw IP is never stored in Redis keys or the in-memory
 * store.
 */
export function createRateLimitKey(
  request: FastifyRequest,
  secret: string,
): string {
  return createIpDigest(request.ip, secret);
}
