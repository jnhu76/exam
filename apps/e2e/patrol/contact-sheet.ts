/**
 * Single owner of patrol contact-sheet rendering (#494 corrective-2).
 *
 * Every patrol contact sheet — navigation, responsive, role, table sibling,
 * and hierarchy sets — must go through `renderContactSheet`. It owns the one
 * artifact pathway: read tile PNGs → base64 encode → build sheet HTML →
 * in-page image-load gate → screenshot → self-proof. Callers pass tile
 * IMAGE PATHS, never pre-encoded data; the historical broken-image defect
 * was a call site hand-assembling the wrong tile shape around the pure HTML
 * builder.
 *
 * Artifact contract (frozen, see patrol/README.md):
 *  - any contact-sheet source image that fails to load → patrol RED;
 *  - any tile id/label/route that is null/undefined/empty/"undefined"/"null"
 *    → patrol RED;
 *  - a declared table sibling with no rendered expected table is reported as
 *    TABLE_COVERAGE_GAP (classifier in patrol-fixtures.ts), never visual PASS.
 */
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { Page } from "@playwright/test";

export interface ContactSheetTile {
  label: string;
  imagePath: string;
}

/** Tile text integrity gate: labels/ids must be real strings naming the
 * tile — never a coercion artifact like the literal text "undefined". */
function isInvalidTileText(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  return (
    trimmed.toLowerCase() === "undefined" || trimmed.toLowerCase() === "null"
  );
}

/** Validate one comparison tile field; throws (patrol RED) on violation. */
export function assertValidTileText(
  value: unknown,
  field: string,
  context: string,
): string {
  if (isInvalidTileText(value)) {
    throw new Error(
      `PATROL ARTIFACT FAILURE: ${context} has invalid ${field}: ${JSON.stringify(value)}`,
    );
  }
  return value as string;
}

export interface ComparisonTileRef {
  id: string;
  label: string;
  route: string;
}

/** Every captured comparison tile must carry a stable id, a real label and a
 * route. This gate is what turns a definition drift like a table-sibling set
 * without ids into an immediate patrol RED instead of "undefined Users". */
export function assertComparisonItem(
  item: ComparisonTileRef,
  context: string,
): void {
  assertValidTileText(item.id, "id", context);
  assertValidTileText(item.label, "label", context);
  assertValidTileText(item.route, "route", context);
}

/**
 * §36 — contact-sheet HTML. Tiles preserve set ordering; labels sit OUTSIDE
 * the application screenshots (never overlaid on the product UI). Images are
 * embedded as data URLs so rendering needs no file:// access.
 */
export function buildContactSheetHtml(
  title: string,
  tiles: Array<{ label: string; imageBase64: string }>,
): string {
  const tileHtml = tiles
    .map(
      (tile) => `
      <figure class="tile">
        <figcaption>${escapeHtml(tile.label)}</figcaption>
        <img alt="${escapeHtml(tile.label)}" src="data:image/png;base64,${tile.imageBase64}" />
      </figure>`,
    )
    .join("\n");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; padding: 16px; background: #222; font-family: sans-serif; }
  h1 { color: #fff; font-size: 16px; font-weight: 600; }
  .grid { display: flex; flex-wrap: wrap; gap: 12px; }
  .tile { margin: 0; background: #fff; padding: 6px; border-radius: 4px; }
  .tile figcaption { font-size: 12px; font-weight: 600; padding-bottom: 4px; }
  .tile img { display: block; width: 320px; height: auto; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="grid">${tileHtml}</div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface RenderContactSheetOptions {
  outputPath: string;
  title: string;
  tiles: readonly ContactSheetTile[];
}

/** Render one contact sheet. Fails loud (patrol RED) if any label is invalid
 * or any source image cannot be loaded with real pixels — it never captures
 * a sheet with broken tiles. DOM.Iterable is unavailable in apps/e2e lib;
 * in-page collection goes through Array.from. */
export async function renderContactSheet(
  page: Page,
  options: RenderContactSheetOptions,
): Promise<void> {
  const { outputPath, title, tiles } = options;
  if (tiles.length === 0) {
    throw new Error(
      `PATROL ARTIFACT FAILURE: contact sheet "${title}" has zero tiles`,
    );
  }
  const encoded = tiles.map((tile, index) => {
    const context = `sheet "${title}" tile ${index + 1}/${tiles.length}`;
    assertValidTileText(tile.label, "label", context);
    assertValidTileText(tile.imagePath, "imagePath", context);
    let png: Buffer;
    try {
      png = readFileSync(tile.imagePath);
    } catch (error) {
      throw new Error(
        `PATROL ARTIFACT FAILURE: ${context} source image unreadable: ${tile.imagePath} (${(error as Error).message})`,
      );
    }
    if (png.length === 0) {
      throw new Error(
        `PATROL ARTIFACT FAILURE: ${context} source image is empty: ${tile.imagePath}`,
      );
    }
    return { label: tile.label, imageBase64: png.toString("base64") };
  });

  await page.setContent(buildContactSheetHtml(title, encoded), {
    waitUntil: "load",
  });

  // Image-load gate: every <img> must have decoded with real intrinsic
  // pixels before the sheet is captured.
  const failures = await page.evaluate(async (expected: number) => {
    const imgs = Array.from(document.querySelectorAll("img"));
    const problems: string[] = [];
    if (imgs.length !== expected) {
      problems.push(`rendered <img> count ${imgs.length} != tiles ${expected}`);
    }
    await Promise.all(
      imgs.map(async (img) => {
        try {
          await img.decode();
        } catch {
          problems.push(
            `image failed to decode: ${img.alt || img.src.slice(0, 64)}`,
          );
        }
      }),
    );
    for (const [index, img] of imgs.entries()) {
      if (!(img.complete && img.naturalWidth > 0 && img.naturalHeight > 0)) {
        problems.push(
          `image ${index + 1}/${imgs.length} has no loaded pixels (complete=${img.complete}, naturalWidth=${img.naturalWidth})`,
        );
      }
    }
    return problems;
  }, tiles.length);
  if (failures.length > 0) {
    throw new Error(
      `PATROL ARTIFACT FAILURE: contact sheet "${title}" image integrity gate failed: ${failures.join("; ")}`,
    );
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  await page.screenshot({ path: outputPath, fullPage: true });

  // Self-proof: the artifact exists and is non-empty. Tile count, image
  // load, and label validity were all gated above, before the screenshot.
  const selfProofContext = `contact sheet "${title}"`;
  if (!statSync(outputPath).isFile() || statSync(outputPath).size === 0) {
    throw new Error(
      `PATROL ARTIFACT FAILURE: ${selfProofContext} produced an empty or missing artifact: ${outputPath}`,
    );
  }
}

/** Stable sheet-tile caption: sequence id + label, with an explicit,
 * non-pixel-overlay coverage marker for table-sibling gap tiles. */
export function sheetTileLabel(item: {
  id: string;
  label: string;
  tableCoverage?: string;
}): string {
  const gap =
    item.tableCoverage === "TABLE_COVERAGE_GAP" ? " [TABLE_COVERAGE_GAP]" : "";
  return `${item.id} ${item.label}${gap}`;
}
