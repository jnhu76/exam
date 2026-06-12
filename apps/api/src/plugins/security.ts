import type { FastifyInstance, FastifyRequest } from "fastify";
import { buildErrorResponse } from "../lib/errorResponse.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readAllowedOrigins(): string[] {
  const list = process.env.ALLOWED_ORIGINS;
  if (list) {
    return list
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const single = process.env.APP_ORIGIN;
  return single ? [single] : [];
}

function originOf(request: FastifyRequest): string | null {
  const origin = request.headers["origin"];
  if (typeof origin === "string" && origin.length > 0) {
    return origin;
  }
  const referer = request.headers["referer"];
  if (typeof referer === "string" && referer.length > 0) {
    try {
      const parsed = new URL(referer);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return null;
    }
  }
  return null;
}

function buildCsp(): string {
  const baseDirectives = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
  ];
  const isProd = process.env.NODE_ENV === "production";
  const scriptSrc = isProd
    ? "script-src 'self'"
    : "script-src 'self' 'unsafe-inline'";
  // style-src keeps 'unsafe-inline' because shadcn/ui + cmdk emit inline style
  // attributes at runtime; revisit in Phase2 when we audit runtime style usage.
  const styleSrc = "style-src 'self' 'unsafe-inline'";
  const directives = [...baseDirectives, scriptSrc, styleSrc];
  if (process.env.COOKIE_SECURE === "true") {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
}

function buildPermissionsPolicy(): string {
  const disabled = [
    "accelerometer",
    "autoplay",
    "camera",
    "display-capture",
    "geolocation",
    "gyroscope",
    "magnetometer",
    "microphone",
    "midi",
    "payment",
    "usb",
  ];
  return disabled.map((feature) => `${feature}=()`).join(", ");
}

export default function setupSecurity(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const str = typeof body === "string" ? body : "";
      if (str.trim() === "") {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(str));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  const allowedOrigins = readAllowedOrigins();
  const csrfActive = process.env.NODE_ENV === "production";
  if (csrfActive && allowedOrigins.length === 0) {
    app.log.warn(
      "CSRF Origin enforcement disabled in production: APP_ORIGIN/ALLOWED_ORIGINS not configured",
    );
  }

  app.addHook("onRequest", (request, reply, done) => {
    if (!csrfActive) {
      done();
      return;
    }
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      done();
      return;
    }
    if (allowedOrigins.length === 0) {
      done();
      return;
    }
    const origin = originOf(request);
    if (!origin || !allowedOrigins.includes(origin)) {
      reply
        .code(403)
        .send(buildErrorResponse(request.id, "CSRF_ORIGIN_REJECTED"));
      return;
    }
    done();
  });

  app.addHook("preHandler", (_req, reply, done) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-XSS-Protection", "0");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Permissions-Policy", buildPermissionsPolicy());
    reply.header("Content-Security-Policy", buildCsp());
    if (process.env.COOKIE_SECURE === "true") {
      reply.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
    done();
  });
}
