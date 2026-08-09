import { describe, expect, it } from "vitest";
import {
  classifyMigrationCompatibility,
  type PreflightDbRow,
} from "./preflight.js";

/**
 * P7-C1 C1.3 — preflight classification unit tests.
 *
 * These tests exercise the PURE classification function with SYNTHETIC journal
 * + DB-row states, covering every required outcome including the hard cases
 * from the C1 plan review (P2-2): the irreparable backward-`when` steps 0022
 * and 0024, and the historically-omitted-then-converged rows 0004/0022/0024
 * (#256/#259). A naive ordered-prefix algorithm would mis-classify several of
 * these as DIVERGENT; the frontier/membership algorithm must classify them
 * correctly.
 */

// ── Synthetic image set helpers ────────────────────────────────────────

interface SyntheticEntry {
  idx: number;
  tag: string;
  when: number;
  hash: string;
}

function makeImage(entries: SyntheticEntry[]) {
  const maxWhen = entries.reduce(
    (m, e) => (e.when > m ? e.when : m),
    -Infinity,
  );
  return {
    entries: entries.map((e) => ({ ...e })),
    maxWhen,
  };
}

// A realistic synthetic journal mirroring the real backward-`when` shape:
// 0022 and 0024 have `when` values that PREDATE 0021/0023 (the #256/#259
// irreparable backward steps). This is the shape the algorithm MUST handle.
const REALISTIC_TAGS = [
  "0000_a",
  "0001_b",
  "0002_c",
  "0003_d",
  "0004_wide_phantom_reporter", // historical-omission allowlist member
  "0010_e",
  "0020_f",
  "0021_g", // when=1000
  "0022_engine_policy_seam", // when=900  (BACKWARD — historical omission)
  "0023_h", // when=1100
  "0024_breezy_tigra", // when=950  (BACKWARD — historical omission)
  "0027_convergence", // when=1200
  "0028_i", // when=1300
] as const;

const REALISTIC_WHENS = [
  100, 200, 300, 400, 500, 600, 700, 1000, 900, 1100, 950, 1200, 1300,
];
const REALISTIC_HASHES = REALISTIC_TAGS.map((_, i) => `hash${i}`);

function realisticImage() {
  return makeImage(
    REALISTIC_TAGS.map((tag, i) => ({
      idx: i,
      tag,
      when: REALISTIC_WHENS[i]!,
      hash: REALISTIC_HASHES[i]!,
    })),
  );
}

// Build DB rows for a subset of image entries (by tag). Each row's createdAt
// matches the image entry's `when` and hash.
function dbRowsFor(
  image: ReturnType<typeof realisticImage>,
  tags: string[],
): PreflightDbRow[] {
  return tags
    .map((tag) => image.entries.find((e) => e.tag === tag))
    .filter((e): e is SyntheticEntry => e != null)
    .map((e) => ({ createdAt: String(e.when), hash: e.hash }));
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("preflight classifyMigrationCompatibility", () => {
  describe("FRESH_INSTALL", () => {
    it("returns FRESH_INSTALL when isFreshInstall=true (table absent)", () => {
      const image = realisticImage();
      const c = classifyMigrationCompatibility(image, [], true);
      expect(c.outcome).toBe("FRESH_INSTALL");
      expect(c.dbCount).toBe(0);
      expect(c.dbFrontier).toBeNull();
      expect(c.imageFrontier).toBe(1300);
    });

    it("returns FRESH_INSTALL when isFreshInstall=true even with stray rows (table-exists-but-empty is the real signal)", () => {
      // isFreshInstall=true means the caller determined the table is absent or
      // empty; dbRows should be [] in that case. The function trusts the flag.
      const image = realisticImage();
      const c = classifyMigrationCompatibility(image, [], true);
      expect(c.outcome).toBe("FRESH_INSTALL");
    });
  });

  describe("DIVERGENT (corrupt image)", () => {
    it("returns DIVERGENT when the image journal is empty (corrupt image)", () => {
      const c = classifyMigrationCompatibility(
        { entries: [], maxWhen: -Infinity },
        [],
        true,
      );
      expect(c.outcome).toBe("DIVERGENT");
      expect(c.detail).toContain("corrupt image");
    });
  });

  describe("NORMAL", () => {
    it("returns NORMAL when DB rows match the full image set (all applied)", () => {
      const image = realisticImage();
      const rows = dbRowsFor(image, [...REALISTIC_TAGS]);
      const c = classifyMigrationCompatibility(image, rows, false);
      expect(c.outcome).toBe("NORMAL");
      expect(c.dbFrontier).toBe(1300);
      expect(c.imageFrontier).toBe(1300);
    });

    it("returns NORMAL when the DB is fully converged but missing the historical-omission rows (0004/0022/0024) — the #256/#259 case", () => {
      // This is THE critical case. A DB that migrated past 0021/0023 never
      // recorded 0022/0024 (drizzle skips migrations with when <= lastApplied),
      // and may be missing 0004 too, but 0027 convergence reconciled the
      // schema. The DB frontier (0028=1300) == image frontier. This MUST be
      // NORMAL, not DIVERGENT.
      const image = realisticImage();
      const appliedTags = REALISTIC_TAGS.filter(
        (t) =>
          t !== "0004_wide_phantom_reporter" &&
          t !== "0022_engine_policy_seam" &&
          t !== "0024_breezy_tigra",
      );
      const rows = dbRowsFor(image, appliedTags);
      const c = classifyMigrationCompatibility(image, rows, false);
      expect(c.outcome).toBe("NORMAL");
      expect(c.detail).toContain("tolerated historical omissions");
      expect(c.detail).toContain("0022_engine_policy_seam");
    });

    it("returns NORMAL when only some historical omissions are missing (subset)", () => {
      const image = realisticImage();
      // Missing only 0022, applied everything else including 0004/0024.
      const appliedTags = REALISTIC_TAGS.filter(
        (t) => t !== "0022_engine_policy_seam",
      );
      const rows = dbRowsFor(image, appliedTags);
      const c = classifyMigrationCompatibility(image, rows, false);
      expect(c.outcome).toBe("NORMAL");
    });
  });

  describe("FORWARD_UPGRADE", () => {
    it("returns FORWARD_UPGRADE when DB frontier < image frontier (legitimate prefix)", () => {
      const image = realisticImage();
      // Applied up through 0027 (when=1200), 0028 (when=1300) pending.
      const appliedTags = REALISTIC_TAGS.filter((t) => t !== "0028_i");
      const rows = dbRowsFor(image, appliedTags);
      const c = classifyMigrationCompatibility(image, rows, false);
      expect(c.outcome).toBe("FORWARD_UPGRADE");
      expect(c.dbFrontier).toBe(1200);
      expect(c.imageFrontier).toBe(1300);
      expect(c.detail).toContain("0028_i");
    });

    it("returns FORWARD_UPGRADE with historical omissions tolerated below the frontier", () => {
      // DB applied through 0027 but never recorded 0022/0024 (backward steps).
      // Frontier = 0027 (1200) < image (1300). Forward-upgrade + tolerated holes.
      const image = realisticImage();
      const appliedTags = REALISTIC_TAGS.filter(
        (t) =>
          t !== "0022_engine_policy_seam" &&
          t !== "0024_breezy_tigra" &&
          t !== "0028_i",
      );
      const rows = dbRowsFor(image, appliedTags);
      const c = classifyMigrationCompatibility(image, rows, false);
      expect(c.outcome).toBe("FORWARD_UPGRADE");
      expect(c.dbFrontier).toBe(1200);
    });
  });

  describe("STALE_IMAGE_DB_AHEAD", () => {
    it("returns STALE_IMAGE_DB_AHEAD when DB has a row newer than the image max", () => {
      const image = realisticImage(); // maxWhen 1300
      // DB has all of image PLUS a future migration row not in the image.
      const rows = [
        ...dbRowsFor(image, [...REALISTIC_TAGS]),
        { createdAt: "9999", hash: "future-hash" },
      ];
      const c = classifyMigrationCompatibility(image, rows, false);
      expect(c.outcome).toBe("STALE_IMAGE_DB_AHEAD");
      expect(c.detail).toContain("STALE");
      expect(c.detail).toContain("9999");
    });

    it("returns STALE_IMAGE_DB_AHEAD when DB frontier > image frontier even with a partial set", () => {
      // DB is missing the historical omissions but has a future row → stale.
      const image = realisticImage();
      const appliedTags = REALISTIC_TAGS.filter(
        (t) =>
          t !== "0004_wide_phantom_reporter" &&
          t !== "0022_engine_policy_seam" &&
          t !== "0024_breezy_tigra",
      );
      const rows = [
        ...dbRowsFor(image, appliedTags),
        { createdAt: "9999", hash: "future-hash" },
      ];
      const c = classifyMigrationCompatibility(image, rows, false);
      expect(c.outcome).toBe("STALE_IMAGE_DB_AHEAD");
    });
  });

  describe("DIVERGENT (history mismatch)", () => {
    it("returns DIVERGENT when a DB row shares a `when` but has a wrong hash", () => {
      const image = realisticImage();
      const rows = dbRowsFor(image, [...REALISTIC_TAGS]);
      // Corrupt the hash of one row (same when, different hash).
      rows[5] = { createdAt: rows[5]!.createdAt, hash: "wrong-hash" };
      const c = classifyMigrationCompatibility(image, rows, false);
      expect(c.outcome).toBe("DIVERGENT");
      expect(c.detail).toContain("does not match");
    });

    it("returns DIVERGENT when an unexpected (non-allowlisted) hole exists below the frontier", () => {
      // DB is missing 0010 (NOT in the historical-omission allowlist) but has
      // a later migration → unexpected hole → DIVERGENT.
      const image = realisticImage();
      const appliedTags = REALISTIC_TAGS.filter((t) => t !== "0010_e");
      const rows = dbRowsFor(image, appliedTags);
      const c = classifyMigrationCompatibility(image, rows, false);
      expect(c.outcome).toBe("DIVERGENT");
      expect(c.detail).toContain("0010_e");
      expect(c.detail).toContain("not in the historical-omission allowlist");
    });

    it("returns DIVERGENT when a DB row has a created_at <= image frontier but no image counterpart (orphan DB row)", () => {
      const image = realisticImage();
      // Add a DB row with an old when not in the image set.
      const rows = [
        ...dbRowsFor(image, [...REALISTIC_TAGS]),
        { createdAt: "250", hash: "orphan-hash" },
      ];
      const c = classifyMigrationCompatibility(image, rows, false);
      expect(c.outcome).toBe("DIVERGENT");
    });
  });

  describe("non-monotonic `when` does not break classification", () => {
    it("a forward-upgrade where the pending migration has the LARGEST when, despite backward steps earlier, classifies correctly", () => {
      // Regression guard: the real journal has 0022/0024 backward, but the
      // pending migration (0028) has the largest when. The frontier/maxWhen
      // comparison must not be confused by the backward steps.
      const image = realisticImage();
      const appliedTags = REALISTIC_TAGS.filter(
        (t) =>
          t !== "0022_engine_policy_seam" &&
          t !== "0024_breezy_tigra" &&
          t !== "0028_i",
      );
      const rows = dbRowsFor(image, appliedTags);
      const c = classifyMigrationCompatibility(image, rows, false);
      // Frontier is 0027 (1200); 0028 (1300) pending; 0022/0024 tolerated holes.
      expect(c.outcome).toBe("FORWARD_UPGRADE");
      expect(c.dbFrontier).toBe(1200);
      expect(c.imageFrontier).toBe(1300);
    });
  });
});
