import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { AuditAction, type AuditActionKey } from "@exam/authz";
import { AUDIT_ACTION_DEFINITIONS } from "./auditPolicy.js";

interface ProductionSource {
  path: string;
  source: string;
}

async function collectProductionSources(
  directory: string,
): Promise<ProductionSource[]> {
  const result: ProductionSource[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await collectProductionSources(path)));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".structural.test.")
    ) {
      result.push({ path, source: await readFile(path, "utf8") });
    }
  }
  return result;
}

const AUDIT_EMITTER_CALLS = new Set([
  "recordAtomicHttpAudit",
  "recordAtomicSystemAudit",
  "recordSensitiveReadAudit",
  "recordBestEffortAudit",
  "executeAdminExamTransition",
]);

function isInsideWriterCall(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isCallExpression(current)) {
      if (
        ts.isIdentifier(current.expression) &&
        AUDIT_EMITTER_CALLS.has(current.expression.text)
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

function emittedActions(file: ProductionSource): AuditActionKey[] {
  if (!file.source.includes("audit/auditWriter.js")) return [];
  const sourceFile = ts.createSourceFile(
    file.path,
    file.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const actions: AuditActionKey[] = [];
  const collectInitializer = (initializer: ts.Expression): void => {
    if (ts.isStringLiteral(initializer)) {
      const value = initializer.text;
      if (Object.values(AuditAction).includes(value as AuditActionKey)) {
        actions.push(value as AuditActionKey);
      }
    } else if (
      ts.isPropertyAccessExpression(initializer) &&
      ts.isIdentifier(initializer.expression) &&
      initializer.expression.text === "AuditAction"
    ) {
      const value =
        AuditAction[initializer.name.text as keyof typeof AuditAction];
      if (value) actions.push(value);
    } else if (ts.isConditionalExpression(initializer)) {
      collectInitializer(initializer.whenTrue);
      collectInitializer(initializer.whenFalse);
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === "action") ||
        (ts.isStringLiteral(node.name) && node.name.text === "action")) &&
      isInsideWriterCall(node)
    ) {
      collectInitializer(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return actions;
}

/**
 * Collects audit action string literals emitted from the exam-engine's
 * audit-callback seam: `deps.audit("incident.created" as string, ...)`.
 * The engine MUST NOT import @exam/authz (dependency rule), so these
 * emitters live outside apps/api and cannot appear as `AuditAction.X`
 * references; the scanner grounds them by literal instead.
 */
function engineAuditLiterals(file: ProductionSource): AuditActionKey[] {
  if (!file.source.includes("deps.audit(")) return [];
  const sourceFile = ts.createSourceFile(
    file.path,
    file.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const actions: AuditActionKey[] = [];
  const collect = (text: string): void => {
    if (Object.values(AuditAction).includes(text as AuditActionKey)) {
      actions.push(text as AuditActionKey);
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "audit" &&
      node.arguments.length > 0
    ) {
      const first = node.arguments[0]!;
      const literal = ts.isStringLiteral(first)
        ? first
        : ts.isAsExpression(first) && ts.isStringLiteral(first.expression)
          ? first.expression
          : null;
      if (literal) collect(literal.text);
    }
    // Version-bump commands pass the audit action through the
    // `auditAction: "incident.investigated" as string` option property.
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "auditAction"
    ) {
      const init =
        ts.isAsExpression(node.initializer) &&
        ts.isStringLiteral(node.initializer.expression)
          ? node.initializer.expression
          : ts.isStringLiteral(node.initializer)
            ? node.initializer
            : null;
      if (init) collect(init.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return actions;
}

describe("audit architecture", () => {
  it("defines every declared action across independent policy dimensions", () => {
    expect(Object.keys(AUDIT_ACTION_DEFINITIONS).sort()).toEqual(
      Object.values(AuditAction).sort(),
    );
    for (const definition of Object.values(AUDIT_ACTION_DEFINITIONS)) {
      expect(definition.lifecycle).toMatch(/^(active|reserved|deprecated)$/);
      expect(definition.durability).toMatch(
        /^(atomic|synchronous_sensitive_read|best_effort|domain_history)$/,
      );
      expect(definition.obligation).toMatch(
        /^(authority|credential|privileged_mutation|privacy_access|domain_state|operational)$/,
      );
      expect(definition.frequency).toMatch(/^(low|medium|high|burst)$/);
      expect(definition.payloadSchema).toBeDefined();
    }
  });

  it("keeps a narrow atomic set and excludes exam runtime domain history", () => {
    // REC-I6 (ADR-014): the nine incident write commands record atomic
    // compliance audits inside their command transaction. That contract
    // block is pinned exactly below; the ratio guard applies to the rest so
    // atomic durability cannot grow unbounded outside a documented contract.
    const INCIDENT_ATOMIC: AuditActionKey[] = [
      AuditAction.IncidentCreated,
      AuditAction.IncidentInvestigated,
      AuditAction.IncidentNoteAdded,
      AuditAction.IncidentSeverityChanged,
      AuditAction.IncidentResolved,
      AuditAction.IncidentDismissed,
      AuditAction.IncidentActionLinked,
      AuditAction.IncidentAttemptLinked,
      AuditAction.IncidentInterruptionLinked,
    ];
    const atomic = Object.entries(AUDIT_ACTION_DEFINITIONS)
      .filter(([, value]) => value.durability === "atomic")
      .map(([action]) => action as AuditActionKey);
    expect(
      atomic.filter((action) => INCIDENT_ATOMIC.includes(action)).sort(),
      "REC-I6 incident atomic block must match the pinned contract set",
    ).toEqual([...INCIDENT_ATOMIC].sort());
    const nonIncidentAtomic = atomic.filter(
      (action) => !INCIDENT_ATOMIC.includes(action),
    );
    expect(nonIncidentAtomic.length).toBeLessThan(
      Object.keys(AuditAction).length / 2,
    );
    for (const action of [
      AuditAction.AttemptStart,
      AuditAction.AttemptSaveAnswer,
      AuditAction.AttemptRestore,
      AuditAction.AttemptAutoSubmit,
      AuditAction.AttemptDisrupted,
      AuditAction.ExamOpen,
      AuditAction.ExamClosed,
    ]) {
      expect(AUDIT_ACTION_DEFINITIONS[action]).toMatchObject({
        lifecycle: "deprecated",
        durability: "domain_history",
      });
    }
  });

  it("grounds active coverage in recursive production emitter inventory", async () => {
    const root = resolve(import.meta.dirname, "..");
    const engineRoot = resolve(
      import.meta.dirname,
      "../../../../packages/exam-engine/src",
    );
    const sources = await collectProductionSources(root);
    const engineSources = await collectProductionSources(engineRoot);
    const owners = new Map<AuditActionKey, string[]>();
    for (const file of sources) {
      for (const action of emittedActions(file)) {
        const paths = owners.get(action) ?? [];
        paths.push(relative(root, file.path));
        owners.set(action, paths);
      }
    }
    for (const file of engineSources) {
      for (const action of engineAuditLiterals(file)) {
        const paths = owners.get(action) ?? [];
        paths.push(`exam-engine/${relative(engineRoot, file.path)}`);
        owners.set(action, paths);
      }
    }

    const active = Object.entries(AUDIT_ACTION_DEFINITIONS)
      .filter(([, value]) => value.lifecycle === "active")
      .map(([action]) => action as AuditActionKey);
    const reserved = Object.entries(AUDIT_ACTION_DEFINITIONS)
      .filter(([, value]) => value.lifecycle === "reserved")
      .map(([action]) => action as AuditActionKey);
    const deprecated = Object.entries(AUDIT_ACTION_DEFINITIONS)
      .filter(([, value]) => value.lifecycle === "deprecated")
      .map(([action]) => action as AuditActionKey);

    expect(active.filter((action) => !owners.has(action))).toEqual([]);
    expect(reserved.filter((action) => owners.has(action))).toEqual([]);
    expect(deprecated.filter((action) => owners.has(action))).toEqual([]);
  });

  it("forbids direct production audit inserts outside the owning writer", async () => {
    const root = resolve(import.meta.dirname, "..");
    const sources = await collectProductionSources(root);
    const bypasses = sources
      .filter(
        (file) =>
          relative(root, file.path) !== "audit/auditWriter.ts" &&
          (/createAuditLogWriter/.test(file.source) ||
            /\.insert\(auditLogs\)/.test(file.source)),
      )
      .map((file) => relative(root, file.path));
    expect(bypasses).toEqual([]);
  });
});
