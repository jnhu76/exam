/**
 * Repeatable benchmark entry (#964 W2: "可重复运行的 benchmark 入口").
 *
 *   pnpm --filter @exam/otel-drizzle-postgresjs bench
 *
 * Guarded by EXAM_DB_TELEMETRY_BENCHMARK=1 so ordinary `pnpm test` never
 * executes it (it shows as skipped). One process, two phases IN ORDER:
 *
 *   A baseline  — the plugin is NOT installed yet (the install turns
 *                 recording on, so the baseline must run first in the same
 *                 process);
 *   B enabled   — the plugin is installed, the pool registered, the same
 *                 workload re-run, spans recorded through a batch processor.
 *
 * Raw counts are the evidence: the workload composition is fixed, so phase
 * B's statement submissions MUST equal the workload's statement count
 * (selects + 6 statements per transaction), and settles must equal
 * submissions. Durations are recorded per phase (p50/p95/mean/max) — the
 * W7.2 acceptance budgets (CPU/p99 ≤5%) are measured on the integrated
 * candidate, not asserted here.
 *
 * Output: one JSONL line per phase, written to
 * EXAM_DB_TELEMETRY_BENCH_OUT (default: <repo>/out/otel-w964/W2.2/artifacts/
 * benchmark.jsonl — an untracked, prettier-ignored evidence path).
 */
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as drizzleSql } from "drizzle-orm";
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { context, trace } from "@opentelemetry/api";
import { getIsolatedTestDb } from "@exam/db/testDb";
import { createDatabase } from "@exam/db/database";
import { executeInTransaction } from "@exam/db/types";
import { schema } from "@exam/db/schema/pg";
import { installOtelDbTelemetry } from "./index.js";

const BENCH_ENABLED = process.env.EXAM_DB_TELEMETRY_BENCHMARK === "1";
const bench = BENCH_ENABLED ? describe : describe.skip;

const SELECT_SLUG = "otelw22bench-target";
const SELECT_SQL = "select display_name from organizations where slug = $1";
const WARMUP_OPS = 20;
const SELECT_OPS = 400;
const TX_OPS = 40;
// statements per executeInTransaction with 3 user statements:
// begin + set transaction + 3 user statements + commit
const STATEMENTS_PER_TX = 6;

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

interface PhaseSample {
  phase: "baseline" | "enabled";
  wallMs: number;
  selectOps: number;
  txOps: number;
  statementCount: number;
  opSamples: number;
  p50Ms: number;
  p95Ms: number;
  meanMs: number;
  maxMs: number;
  diagnostics?: Record<string, unknown>;
  spans?: number;
}

function appendEvidence(line: PhaseSample): void {
  const out =
    process.env.EXAM_DB_TELEMETRY_BENCH_OUT ??
    path.join(
      fileURLToPath(new URL("../../../..", import.meta.url)),
      "out/otel-w964/W2.2/artifacts/benchmark.jsonl",
    );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.appendFileSync(out, `${JSON.stringify(line)}\n`);
}

bench("db telemetry benchmark (baseline vs enabled, raw counts)", () => {
  let iso: Awaited<ReturnType<typeof getIsolatedTestDb>>;
  let sql: postgres.Sql;
  const exporter = new InMemorySpanExporter();

  beforeAll(async () => {
    iso = await getIsolatedTestDb("otelw22bench");
    const now = new Date();
    for (let i = 0; i < 12; i += 1) {
      await iso.db.insert(schema.organizations).values({
        id: randomUUID(),
        name: `${SELECT_SLUG}-${i}`,
        displayName: `${SELECT_SLUG}-${i}`,
        slug: i === 0 ? SELECT_SLUG : `${SELECT_SLUG}-${i}`,
        createdAt: now,
        updatedAt: now,
      });
    }
    // max 3 + startup search_path (W2.1 F5) — the pool the workload rides
    sql = postgres(iso.databaseUrl!, {
      max: 3,
      connection: { search_path: iso.schemaName },
    });
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await iso?.cleanup();
  }, 30_000);

  it("runs phase A (baseline, no install) then phase B (enabled) with raw counts", async () => {
    const db = drizzle(sql, { schema });
    const warmup = async (): Promise<void> => {
      for (let i = 0; i < WARMUP_OPS; i += 1) {
        await sql.unsafe(SELECT_SQL, [SELECT_SLUG]);
      }
    };
    // Measured workload: SELECT_OPS selects + TX_OPS transactions. Every
    // awaited op is one sample; results are asserted (same work both phases).
    const runWorkload = async (): Promise<number[]> => {
      const samples: number[] = [];
      for (let i = 0; i < SELECT_OPS; i += 1) {
        const t0 = performance.now();
        const rows = (await sql.unsafe(SELECT_SQL, [
          i % 12 === 0 ? SELECT_SLUG : `${SELECT_SLUG}-${i % 12}`,
        ])) as Array<{ display_name: string }>;
        samples.push(performance.now() - t0);
        expect(rows[0]!.display_name).toContain(SELECT_SLUG);
      }
      for (let i = 0; i < TX_OPS; i += 1) {
        const t0 = performance.now();
        await executeInTransaction(db, async (tx) => {
          await tx.execute(
            drizzleSql`update organizations set updated_at = now() where slug = ${SELECT_SLUG}`,
          );
          const rows = (await tx.execute(
            drizzleSql`select count(*)::int as n from organizations where slug like ${`${SELECT_SLUG}%`}`,
          )) as unknown as Array<{ n: number }>;
          expect(rows[0]!.n).toBe(12);
          await tx.execute(
            drizzleSql`update organizations set updated_at = now() where slug = ${`${SELECT_SLUG}-1`}`,
          );
        });
        samples.push(performance.now() - t0);
      }
      return samples;
    };

    // ---- Phase A: baseline (prototype patch NOT installed) -----------
    await warmup();
    const baselineStart = performance.now();
    const baselineSamples = await runWorkload();
    const baselineWall = performance.now() - baselineStart;
    const statementCount = SELECT_OPS + TX_OPS * STATEMENTS_PER_TX;
    const baselineSorted = [...baselineSamples].sort((a, b) => a - b);
    appendEvidence({
      phase: "baseline",
      wallMs: Math.round(baselineWall * 100) / 100,
      selectOps: SELECT_OPS,
      txOps: TX_OPS,
      statementCount,
      opSamples: baselineSamples.length,
      p50Ms: Math.round(percentile(baselineSorted, 0.5) * 1000) / 1000,
      p95Ms: Math.round(percentile(baselineSorted, 0.95) * 1000) / 1000,
      meanMs:
        Math.round(
          (baselineSamples.reduce((a, b) => a + b, 0) /
            baselineSamples.length) *
            1000,
        ) / 1000,
      maxMs: Math.round(baselineSorted.at(-1)! * 1000) / 1000,
    });

    // ---- Phase B: enabled (installed after the baseline already ran) ----
    const provider = new TracerProvider({
      spanProcessors: [
        new BatchSpanProcessor({
          exporter,
          scheduledDelayMillis: 120_000,
        }),
      ],
    });
    trace.setGlobalTracerProvider(provider);
    context.setGlobalContextManager(new AsyncLocalStorageContextManager());
    const handle = installOtelDbTelemetry();
    handle.registerRootConnection(sql);
    // Warmup BEFORE the diagnostics window: the delta then covers exactly
    // the measured workload.
    await warmup();
    const diagBefore = handle.diagnostics();

    const enabledStart = performance.now();
    const enabledSamples = await runWorkload();
    const enabledWall = performance.now() - enabledStart;
    const diagAfter = handle.diagnostics();
    await provider.forceFlush();
    const enabledSorted = [...enabledSamples].sort((a, b) => a - b);

    // RAW COUNT CROSS-CHECK: the seam counted exactly the workload's
    // statements — every submitted statement is measured exactly once.
    expect(diagAfter.submissions - diagBefore.submissions).toBe(statementCount);
    expect(diagAfter.settles - diagBefore.settles).toBe(statementCount);
    expect(diagAfter.errors - diagBefore.errors).toBe(0);
    // role split: root = the selects + each transaction's BEGIN (issued on
    // the root pool); transaction = the 5 scoped statements per transaction
    // (set-transaction + 3 user statements + commit on the reserved
    // connection's own handler closure)
    expect(
      (diagAfter.byRole["root"] ?? 0) - (diagBefore.byRole["root"] ?? 0),
    ).toBe(SELECT_OPS + TX_OPS);
    expect(
      (diagAfter.byRole["transaction"] ?? 0) -
        (diagBefore.byRole["transaction"] ?? 0),
    ).toBe(TX_OPS * (STATEMENTS_PER_TX - 1));
    // every executeInTransaction created its sql.begin scoped closure
    expect(diagAfter.scopedClosures - diagBefore.scopedClosures).toBe(TX_OPS);

    appendEvidence({
      phase: "enabled",
      wallMs: Math.round(enabledWall * 100) / 100,
      selectOps: SELECT_OPS,
      txOps: TX_OPS,
      statementCount,
      opSamples: enabledSamples.length,
      p50Ms: Math.round(percentile(enabledSorted, 0.5) * 1000) / 1000,
      p95Ms: Math.round(percentile(enabledSorted, 0.95) * 1000) / 1000,
      meanMs:
        Math.round(
          (enabledSamples.reduce((a, b) => a + b, 0) / enabledSamples.length) *
            1000,
        ) / 1000,
      maxMs: Math.round(enabledSorted.at(-1)! * 1000) / 1000,
      diagnostics: diagAfter as unknown as Record<string, unknown>,
      spans: exporter.getFinishedSpans().length,
    });
  }, 240_000);
});
