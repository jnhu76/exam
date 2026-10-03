import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Campaign run-recorder. Each campaign file accumulates counters and flushes
 * one JSON artifact into ../results/ so the final report cites executed
 * evidence, not intentions. Seed values are recorded explicitly (Phase-E §6).
 */
const resultsDir = path.resolve(import.meta.dirname, "../results");

export class CampaignRecorder {
  private readonly entries: Array<Record<string, unknown>> = [];
  constructor(
    readonly campaign: string,
    readonly seeds: number[],
  ) {}

  record(entry: Record<string, unknown>): void {
    this.entries.push(entry);
  }

  flush(extra: Record<string, unknown> = {}): void {
    mkdirSync(resultsDir, { recursive: true });
    const file = path.join(
      resultsDir,
      `${this.campaign}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    writeFileSync(
      file,
      JSON.stringify(
        {
          campaign: this.campaign,
          seeds: this.seeds,
          recordedAt: new Date().toISOString(),
          ...extra,
          entries: this.entries,
        },
        null,
        2,
      ),
    );
  }
}
