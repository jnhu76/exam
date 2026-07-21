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
        (ts.isStringLiteral(node.name) && node.name.text === "action"))
    ) {
      collectInitializer(node.initializer);
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
    const atomic = Object.entries(AUDIT_ACTION_DEFINITIONS)
      .filter(([, value]) => value.durability === "atomic")
      .map(([action]) => action);
    expect(atomic.length).toBeLessThan(Object.keys(AuditAction).length / 2);
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
    const sources = await collectProductionSources(root);
    const owners = new Map<AuditActionKey, string[]>();
    for (const file of sources) {
      for (const action of emittedActions(file)) {
        const paths = owners.get(action) ?? [];
        paths.push(relative(root, file.path));
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
