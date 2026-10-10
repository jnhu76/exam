/**
 * Route-facts extractor (#764 R1-B) — the apps/api-owned observation of the
 * composed runtime surface plus the declared registry metadata.
 *
 * Runtime truth comes from the REAL composed application: the same
 * `apiSurface` plugin registration the production server performs, captured
 * through a Fastify `onRoute` hook — the existing whole-app capture seam
 * (routeRegistryConformanceWholeApp.test.ts), reused rather than reinvented.
 * No production behaviour is modified; no database connection is ever made
 * (the db plugin decorates a lazily-connecting handle; nothing queries it
 * during composition).
 *
 * The declared block is mirrored from `ROUTE_PERMISSION_REGISTRY` (test-only
 * metadata) WITHOUT promotion: both blocks stay in the artifact, and the
 * declared/runtime divergence is derived downstream by @exam/atlas (O-07).
 *
 * Output: canonical JSON at packages/atlas/input/route-facts.json — an
 * explicit build input, so the Atlas build itself never executes the app and
 * never touches the network.
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyPluginAsync } from "fastify";
import ts from "typescript";
import apiSurfacePlugin from "../routes/apiSurface.js";
import authPlugin from "../plugins/auth.js";
import authzScopedPlugin from "../plugins/authz.js";
import zodProviderPlugin from "../plugins/zodProvider.js";
import emailPlugin from "../plugins/email.js";
import auditLifecyclePlugin from "../plugins/auditLifecycle.js";
import { setupErrorHandler } from "../plugins/errors.js";
import setupSecurity from "../plugins/security.js";
import dbPlugin from "../plugins/db.js";
import nowPlugin from "../plugins/now.js";
import {
  ROUTE_PERMISSION_REGISTRY,
  type RoutePermissionRegistryEntry,
} from "../authz/routeRegistry.js";
import type { AuthzPreHandler } from "../types/fastify-auth.d.js";
import { Permission } from "@exam/authz";

const API_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTPUT_PATH = join(
  API_ROOT,
  "..",
  "..",
  "packages",
  "atlas",
  "input",
  "route-facts.json",
);

/**
 * Canonical JSON for the artifact (sorted keys recursively, 2-space indent).
 * The @exam/atlas build consumes these bytes as an explicit input and hashes
 * them as-read, so only byte stability matters here — not shared code.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

export interface CapturedRoute {
  method: string;
  url: string;
  /** Route-level classification derived from the production preHandler tags. */
  gate: {
    authentication_handler_count: number;
    role_handler_count: number;
    permission_list_handler_count: number;
    capability_handler_count: number;
  };
  gate_kind:
    | "CAPABILITY"
    | "RESOURCE_AWARE_CAPABILITY"
    | "AUTH_ONLY"
    | "PUBLIC"
    | "UNKNOWN";
  permission?: string;
  resolver?: string;
  resource_id_key?: string;
}

/** Classifier over production preHandler introspection tags (conformance seam). */
interface PreHandlerClassification {
  authentication: number;
  role: number;
  permissionList: number;
  capability: number;
  permission: string | undefined;
  resolver: string | undefined;
  resourceIdKey: string | undefined;
  scoped: boolean;
  scoreCapability: boolean;
}

function classifyPreHandler(preHandler: unknown): PreHandlerClassification {
  const result: PreHandlerClassification = {
    authentication: 0,
    role: 0,
    permissionList: 0,
    capability: 0,
    permission: undefined,
    resolver: undefined,
    resourceIdKey: undefined,
    scoped: false,
    scoreCapability: false,
  };
  const handlers = Array.isArray(preHandler)
    ? preHandler
    : preHandler
      ? [preHandler]
      : [];
  for (const handler of handlers) {
    if (handler === undefined || handler === null) continue;
    const tagged = handler as {
      _isAuthenticate?: boolean;
      _isRequireRole?: boolean;
      _isRequirePermission?: boolean;
      _isScoreCapability?: boolean;
      authz?: AuthzPreHandler["authz"];
    };
    if (tagged._isAuthenticate === true) {
      result.authentication += 1;
      continue;
    }
    if (tagged._isRequireRole === true) {
      result.role += 1;
      continue;
    }
    if (tagged._isRequirePermission === true) {
      result.permissionList += 1;
      continue;
    }
    // The score gate attaches no `.authz` metadata by design (P4-V0 §7.2);
    // its `_isScoreCapability` tag is the sanctioned classification surface.
    if (tagged._isScoreCapability === true) {
      result.capability += 1;
      result.scoreCapability = true;
      continue;
    }
    const authz = tagged.authz;
    if (authz !== undefined) {
      result.capability += 1;
      if (authz.kind === "flat" || authz.kind === "scoped") {
        result.permission = authz.permission;
        if (authz.kind === "scoped") {
          result.scoped = true;
          result.resolver = authz.resolverKey;
          result.resourceIdKey = authz.resourceIdKey;
        }
      }
    }
  }
  return result;
}

/**
 * Compose the full production route surface and capture every registered
 * route. Mirrors the whole-app conformance composition (security, error
 * handler, zod provider, cookie, db, audit lifecycle, now, auth, authz —
 * then the apiSurface plugin owning the /api prefix).
 */
export async function captureRouteFacts(): Promise<{
  routes: CapturedRoute[];
  registry: Array<Record<string, unknown>>;
}> {
  const captured: CapturedRoute[] = [];

  const capturePlugin: FastifyPluginAsync = async (fastify) => {
    fastify.addHook("onRoute", (routeOptions) => {
      // Fastify auto-generates HEAD aliases for GET routes; the conformance
      // seam excludes them and so does this capture.
      if (routeOptions.method === "HEAD") return;
      const classification = classifyPreHandler(routeOptions.preHandler);
      const methods = Array.isArray(routeOptions.method)
        ? routeOptions.method.join("|")
        : String(routeOptions.method);
      const gateKind: CapturedRoute["gate_kind"] =
        classification.capability > 0
          ? classification.scoped
            ? "RESOURCE_AWARE_CAPABILITY"
            : "CAPABILITY"
          : classification.authentication > 0 && classification.capability === 0
            ? "AUTH_ONLY"
            : classification.capability === 0 &&
                classification.authentication === 0
              ? "PUBLIC"
              : "UNKNOWN";
      captured.push({
        method: methods,
        url: String(routeOptions.url),
        gate: {
          authentication_handler_count: classification.authentication,
          role_handler_count: classification.role,
          permission_list_handler_count: classification.permissionList,
          capability_handler_count: classification.capability,
        },
        gate_kind: gateKind,
        ...(classification.permission !== undefined
          ? { permission: classification.permission }
          : {}),
        ...(classification.resolver !== undefined
          ? { resolver: classification.resolver }
          : {}),
        ...(classification.resourceIdKey !== undefined
          ? { resource_id_key: classification.resourceIdKey }
          : {}),
      });
    });
    // The full production composition: the apiSurface plugin owns the /api
    // prefix and every route module, exactly as the runtime server does.
    await fastify.register(apiSurfacePlugin, { prefix: "/api" });
  };

  const app = Fastify({ logger: false });
  setupSecurity(app);
  setupErrorHandler(app);
  await app.register(zodProviderPlugin);
  await app.register(fastifyCookie);
  await app.register(dbPlugin);
  await app.register(auditLifecyclePlugin);
  await app.register(nowPlugin);
  await app.register(authPlugin);
  await app.register(authzScopedPlugin);
  await app.register(emailPlugin);
  await app.register(capturePlugin);
  await app.ready();
  await app.close();

  const routes = [...captured].sort((a, b) =>
    `${a.method}|${a.url}` < `${b.method}|${b.url}` ? -1 : 1,
  );
  const registry = ROUTE_PERMISSION_REGISTRY.map(registryEntryToJson).sort(
    (a, b) =>
      `${String(a["method"])}|${String(a["path"])}` <
      `${String(b["method"])}|${String(b["path"])}`
        ? -1
        : 1,
  );
  return { routes, registry };
}

function registryEntryToJson(
  entry: RoutePermissionRegistryEntry,
): Record<string, unknown> {
  return {
    method: entry.method,
    path: entry.path,
    legacy_gate: entry.legacyGate,
    permission: entry.permission,
    scope: entry.scope,
    resolver: entry.resolver,
    ...(entry.runtimeAuthz !== undefined
      ? { runtime_authz_kind: entry.runtimeAuthz.kind }
      : {}),
    ...(entry.auditAction !== undefined
      ? { audit_action: entry.auditAction }
      : {}),
    sensitive: entry.sensitive,
    proctor_access: entry.proctorAccess,
    migration_stage: entry.migrationStage,
  };
}

/**
 * ATLAS-IR-091 detection — in-handler authorization branches that narrow a
 * route's response beyond its pre-handler gate. AST walk over the route
 * modules: every `Permission.<Key>` reference that is NOT a pre-handler
 * registration argument is a candidate. Candidates the join cannot classify
 * are reported as unclassified downstream — never silently omitted.
 */
export function detectAdditionalGateCandidates(): Array<{
  file: string;
  line: number;
  permission_key: string;
  enclosing_function: string;
  inside_prehandler_registration: boolean;
}> {
  const routesDir = join(API_ROOT, "src", "routes");
  const candidates: Array<{
    file: string;
    line: number;
    permission_key: string;
    enclosing_function: string;
    inside_prehandler_registration: boolean;
  }> = [];
  // The AST sees catalog PROPERTY names (SystemBusinessIntegrityView), not
  // the wire keys, so the match set is the key side of the catalog.
  const permissionNames = new Set(Object.keys(Permission));

  const files = readdirSync(routesDir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );
  for (const file of files) {
    const path = join(routesDir, file);
    const text = readFileSync(path, "utf8");
    const source = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
    );

    const enclosing = (node: ts.Node): string => {
      let current = node.parent;
      while (current !== undefined) {
        if (
          ts.isFunctionDeclaration(current) ||
          ts.isMethodDeclaration(current)
        ) {
          return current.name !== undefined && ts.isIdentifier(current.name)
            ? current.name.text
            : "<anonymous>";
        }
        if (
          ts.isVariableDeclaration(current) &&
          ts.isIdentifier(current.name)
        ) {
          return current.name.text;
        }
        current = current.parent;
      }
      return "<module>";
    };

    // The production pre-handler gate factories. A Permission.* argument to
    // any of them is the route's declared pre-handler gate, not an in-handler
    // branch; anything else is an ATLAS-IR-091 candidate.
    const GATE_FACTORIES = new Set([
      "requireCapability",
      "requireScopedCapability",
      "requireCandidateContext",
      "requireExamEligibility",
      "requireOwnAttempt",
      "requireScoreCapability",
    ]);
    const isPreHandlerPosition = (node: ts.Node): boolean => {
      if (node.parent !== undefined && ts.isCallExpression(node.parent)) {
        const expression = node.parent.expression;
        const calleeName = ts.isPropertyAccessExpression(expression)
          ? expression.name.text
          : ts.isIdentifier(expression)
            ? expression.text
            : undefined;
        if (
          calleeName !== undefined &&
          GATE_FACTORIES.has(calleeName) &&
          node.parent.arguments[0] === node
        ) {
          return true;
        }
      }
      return false;
    };

    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression)
      ) {
        const propertyName = node.name.text;
        if (
          node.expression.text === "Permission" &&
          permissionNames.has(propertyName)
        ) {
          candidates.push({
            file: relative(API_ROOT, path),
            line:
              source.getLineAndCharacterOfPosition(node.getStart(source)).line +
              1,
            permission_key: propertyName,
            enclosing_function: enclosing(node),
            inside_prehandler_registration: isPreHandlerPosition(node),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
  }
  return candidates.sort((a, b) =>
    `${a.file}|${a.line}|${a.permission_key}` <
    `${b.file}|${b.line}|${b.permission_key}`
      ? -1
      : 1,
  );
}

function observedHeadSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

export async function main(): Promise<void> {
  const { routes, registry } = await captureRouteFacts();
  const candidates = detectAdditionalGateCandidates();
  const artifact = {
    extractor: { id: "@exam/api/atlas-route-facts", version: "0.1.0" },
    observed_head: observedHeadSha(),
    routes,
    registry,
    additional_gate_candidates: candidates,
  };
  writeFileSync(OUTPUT_PATH, canonicalJson(artifact));
  process.stdout.write(
    `route-facts: wrote ${OUTPUT_PATH}\n  routes=${routes.length} registry=${registry.length} additional_gate_candidates=${candidates.length}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("extractRouteFacts.ts")
) {
  main().catch((error: unknown) => {
    process.stderr.write(`route-facts: ${String(error)}\n`);
    process.exit(1);
  });
}
