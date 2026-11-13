/**
 * Reversible seam lifecycle on real PostgreSQL (#974, #964 W2 acceptance:
 * "patch 支持关闭清理和测试隔离"). Owns the structural start/stop contract
 * the owner review pinned:
 *
 *   install captures the pristine Query.prototype references ONCE (single
 *   decision) and patches; disable() restores the patched methods to the
 *   pristine references EXACTLY — per-property descriptor equality against a
 *   pre-install baseline (value identity included), every other property
 *   untouched — while real business queries stay healthy through the
 *   disabled window; enable() re-applies the patch and resumes recording;
 *   the cycle repeats and disable is idempotent.
 *
 * The behavioral half (no recording while disabled, recording resumed after
 * enable) is asserted through the plugin's diagnostics deltas around single
 * real queries — the same pool the business query rides, warmed up before
 * install so the delta windows are pool-shaped (see the main suite).
 *
 * This file runs in its own vitest worker (file isolation) so its
 * pre-install baseline window is real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { getIsolatedTestDb } from "@exam/db/testDb";
import { createDatabase } from "@exam/db/database";
import { schema } from "@exam/db/schema/pg";
import { installOtelDbTelemetry } from "./index.js";
import { isStatementSeamPatched } from "./driverStatementSeam.js";

/** The Query.prototype property map the patch may touch (and must restore). */
type PrototypeSnapshot = Record<string, PropertyDescriptor>;

/** Fresh marker client → prototype descriptors (the seam's own shape). */
function snapshotQueryPrototype(): PrototypeSnapshot {
  const probe = postgres("postgres://127.0.0.1:1/none");
  const marker = probe.unsafe("select 1");
  const proto = Object.getPrototypeOf(marker) as object;
  probe.end({ timeout: 0 });
  const snapshot: PrototypeSnapshot = {};
  for (const key of Object.getOwnPropertyNames(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (descriptor) snapshot[key] = descriptor;
  }
  return snapshot;
}

/** Identity comparison of a descriptor — function values by reference. */
function sameDescriptor(a: PropertyDescriptor, b: PropertyDescriptor): boolean {
  return (
    a.value === b.value &&
    a.writable === b.writable &&
    a.enumerable === b.enumerable &&
    a.configurable === b.configurable &&
    a.get === b.get &&
    a.set === b.set
  );
}

/** Sorted own-property keys whose descriptors differ between snapshots. */
function changedKeys(
  baseline: PrototypeSnapshot,
  current: PrototypeSnapshot,
): string[] {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  const changed: string[] = [];
  for (const key of keys) {
    const before = baseline[key];
    const after = current[key];
    if (!before || !after || !sameDescriptor(before, after)) {
      changed.push(key);
    }
  }
  return changed.sort();
}

/** The five methods the seam patches (driverStatementSeam.ts). */
const PATCHED_METHODS = [
  "catch",
  "execute",
  "finally",
  "forEach",
  "then",
] as const;

describe("reversible driver statement seam lifecycle (real PostgreSQL)", () => {
  let iso: Awaited<ReturnType<typeof getIsolatedTestDb>>;
  let probe: Awaited<ReturnType<typeof createDatabase>>;
  let sql: postgres.Sql;
  let baseline: PrototypeSnapshot;
  let handle: ReturnType<typeof installOtelDbTelemetry>;
  let orgId: string;

  beforeAll(async () => {
    iso = await getIsolatedTestDb("otelw22cycle");
    probe = await createDatabase(iso.databaseUrl!, iso.schemaName);
    orgId = randomUUID();
    await iso.db.insert(schema.organizations).values({
      id: orgId,
      name: "otelw22cycle-a",
      displayName: "otelw22cycle-a",
      slug: "otelw22cycle-a",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    sql = postgres(iso.databaseUrl!, {
      max: 3,
      connection: { search_path: iso.schemaName },
    });
    // Pool warmup BEFORE install (unpatched window): the first-connection
    // pg_type fetch stays out of every diagnostics delta below.
    await sql.unsafe("select 1");
    baseline = snapshotQueryPrototype();
    expect(isStatementSeamPatched()).toBe(false);
  }, 60_000);

  afterAll(async () => {
    // Cleanup intentionally runs in the DISABLED terminal state left by the
    // last step — the pristine prototype must carry pool end + schema
    // cleanup untouched.
    await probe?.sql.end();
    await sql?.end({ timeout: 5 });
    await iso?.cleanup();
  }, 30_000);

  it("install patches the five target methods and touches no other property", async () => {
    handle = installOtelDbTelemetry();
    expect(isStatementSeamPatched()).toBe(true);

    const patched = snapshotQueryPrototype();
    expect(changedKeys(baseline, patched)).toEqual([...PATCHED_METHODS]);

    // Behavioral: a real query is healthy and recorded exactly once.
    const before = handle.diagnostics();
    const rows = (await sql.unsafe(
      "select display_name from organizations where slug = $1",
      ["otelw22cycle-a"],
    )) as unknown as Array<{ display_name: string }>;
    expect(rows[0]!.display_name).toBe("otelw22cycle-a");
    const delta = {
      submissions: handle.diagnostics().submissions - before.submissions,
      settles: handle.diagnostics().settles - before.settles,
      errors: handle.diagnostics().errors - before.errors,
    };
    expect(delta).toEqual({ submissions: 1, settles: 1, errors: 0 });
  }, 30_000);

  it("disable() restores the pristine prototype exactly and stops recording", async () => {
    handle.disable();
    expect(handle.isEnabled()).toBe(false);
    expect(isStatementSeamPatched()).toBe(false);

    // STRUCTURAL: per-property equality with the pre-install baseline —
    // descriptor attributes AND function identity, the full property map.
    expect(snapshotQueryPrototype()).toEqual(baseline);

    // BEHAVIORAL: the business query is healthy through the disabled window
    // and the plugin records nothing.
    const before = handle.diagnostics();
    const rows = (await sql.unsafe(
      "select display_name from organizations where id = $1",
      [orgId],
    )) as unknown as Array<{ display_name: string }>;
    expect(rows[0]!.display_name).toBe("otelw22cycle-a");
    expect({
      submissions: handle.diagnostics().submissions - before.submissions,
      settles: handle.diagnostics().settles - before.settles,
      errors: handle.diagnostics().errors - before.errors,
    }).toEqual({ submissions: 0, settles: 0, errors: 0 });
  }, 30_000);

  it("enable() re-applies the patch and resumes recording; repeat enable is a no-op", async () => {
    handle.enable();
    handle.enable(); // idempotent
    expect(handle.isEnabled()).toBe(true);
    expect(isStatementSeamPatched()).toBe(true);

    // Structural: exactly the five target methods are patched again.
    const patched = snapshotQueryPrototype();
    expect(changedKeys(baseline, patched)).toEqual([...PATCHED_METHODS]);

    // Behavioral: recording resumed.
    const before = handle.diagnostics();
    const rows = (await sql.unsafe(
      "select 1::int as one",
    )) as unknown as Array<{ one: number }>;
    expect(rows[0]!.one).toBe(1);
    expect({
      submissions: handle.diagnostics().submissions - before.submissions,
      settles: handle.diagnostics().settles - before.settles,
      errors: handle.diagnostics().errors - before.errors,
    }).toEqual({ submissions: 1, settles: 1, errors: 0 });
  }, 30_000);

  it("the cycle repeats: second disable restores pristine again, repeat disable is idempotent", async () => {
    handle.disable();
    expect(snapshotQueryPrototype()).toEqual(baseline);
    handle.disable(); // idempotent — no throw, still pristine
    expect(handle.isEnabled()).toBe(false);
    expect(isStatementSeamPatched()).toBe(false);
    expect(snapshotQueryPrototype()).toEqual(baseline);

    // The disabled prototype still serves real business queries.
    const rows = (await sql.unsafe(
      "select count(*)::int as n from organizations where slug = $1",
      ["otelw22cycle-a"],
    )) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
  }, 30_000);
});
