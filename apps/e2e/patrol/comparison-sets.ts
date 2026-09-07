/**
 * UI-MULTIMODAL-PATROL comparison-set definitions (#494 §33-§42).
 *
 * Pure, dependency-free module: the patrol spec executes these definitions
 * (capture + metadata), and the historical false-negative regression pins
 * their shape. A comparison set holds persona, viewport, responsive shell
 * state, browser, and seed constant, and varies exactly one meaningful
 * dimension (route / persona / viewport / state) so multimodal differences
 * are interpretable.
 */

export interface SequenceStop {
  /** Ordered display label used on contact sheets, e.g. "01 Dashboard". */
  id: string;
  label: string;
  route: string;
}

/** §35 Set A — Admin shell continuity: same persona+viewport, route varies.
 * Ordering is part of the contract (#492 cross-screenshot review walked this
 * sequence; #493 judged each screenshot independently and missed it). */
export const ADMIN_NAV_SEQUENCE: SequenceStop[] = [
  { id: "01", label: "Dashboard", route: "/admin/dashboard" },
  { id: "02", label: "Operations", route: "/admin/operations" },
  { id: "03", label: "System", route: "/admin/system" },
  { id: "04", label: "Courses", route: "/admin/courses" },
  { id: "05", label: "Questions", route: "/admin/questions" },
  { id: "06", label: "Exams", route: "/admin/exams" },
  { id: "07", label: "Grading Queue", route: "/admin/grading-queue" },
  { id: "08", label: "Results", route: "/admin/results" },
  { id: "09", label: "Proctor", route: "/admin/proctor" },
  { id: "10", label: "Recovery", route: "/admin/recovery" },
  { id: "11", label: "Users", route: "/admin/users" },
  { id: "12", label: "Candidates", route: "/admin/candidates" },
  { id: "13", label: "Audit Logs", route: "/admin/audit-logs" },
  { id: "14", label: "Settings", route: "/admin/settings" },
];

/** §37 Set B — responsive shell: same route, viewport band varies. */
export const RESPONSIVE_VIEWPORTS = [
  { id: "1440x900", width: 1440, height: 900 },
  { id: "1280x800", width: 1280, height: 800 },
  { id: "1100x800", width: 1100, height: 800 },
  { id: "1023x800", width: 1023, height: 800 },
  { id: "375x812", width: 375, height: 812 },
  { id: "320x800", width: 320, height: 800 },
] as const;

export const RESPONSIVE_ROUTE = "/admin/exams";

/** §38 Set C — role shell: same viewport, persona varies. The question is
 * whether capability filtering preserves the navigation grammar, not whether
 * every role sees the same destinations. */
export const ROLE_SURFACES = [
  { id: "admin", label: "Admin", route: "/admin/dashboard" },
  { id: "teacher", label: "Teacher", route: "/admin/exams" },
  { id: "grader", label: "Grader", route: "/admin/grading-queue" },
  { id: "proctor", label: "Proctor", route: "/admin/proctor" },
] as const;

/** §39 Set D — table siblings grouped by archetype, same viewport. */
export const TABLE_SIBLING_SETS = [
  {
    id: "management",
    archetype: "management-list",
    sheet: "TABLE-COMPARE-management-1280.png",
    routes: [
      { label: "Users", route: "/admin/users" },
      { label: "Candidates", route: "/admin/candidates" },
      { label: "Courses", route: "/admin/courses" },
      { label: "Questions", route: "/admin/questions" },
      { label: "Exams", route: "/admin/exams" },
      { label: "Grading Queue", route: "/admin/grading-queue" },
    ],
  },
  {
    id: "diagnostic",
    archetype: "log-diagnostic",
    sheet: "TABLE-COMPARE-diagnostic-1280.png",
    routes: [
      { label: "Audit Logs", route: "/admin/audit-logs" },
      { label: "Import Logs", route: "/admin/import-logs" },
    ],
  },
] as const;

export const SHELL_COMPARISON_VIEWPORT = { width: 1280, height: 800 };
export const ROLE_COMPARISON_VIEWPORT = { width: 1440, height: 900 };

/**
 * §40 — the permanent black-box multimodal comparison review prompt. The
 * patrol writes it into every run output; reviewers (human or multimodal
 * model) MUST compare equivalent states across a set instead of judging
 * screenshots independently. Discovery, not conviction: every HIGH/MEDIUM
 * candidate goes through deterministic DOM confirmation before it is called
 * a defect (§41).
 */
export const COMPARISON_REVIEW_PROMPT = `You are reviewing a sequence of screenshots from the SAME product.

Do not judge each screenshot independently.

The comparison set metadata tells you which dimensions are held constant
and which one changes.

Your job is to detect inconsistency across equivalent states.

For NAVIGATION comparisons, inspect ONLY:

1. shell/sidebar width and overall structure;
2. brand/header region;
3. navigation group ordering;
4. item ordering and vertical rhythm;
5. visibility and clarity of the active/current destination;
6. whether the current destination appears lost outside the visible nav;
7. unexpected scroll-state discontinuity;
8. orphan headings or separators;
9. footer/user/logout location;
10. capability-filtered navigation coherence.

A changed active item is EXPECTED.
A changed nav scrollTop may be EXPECTED if required to reveal the active item.

Do not report differences merely because page content changes.

For TABLE sibling comparisons, inspect:

1. outer table containment;
2. title/toolbar geometry;
3. header/row alignment;
4. action/status column behavior;
5. clipping or collision;
6. unexplained horizontal compression;
7. inconsistent local-scroll affordance;
8. sticky-column artifacts;
9. identical semantic roles appearing radically different;
10. hidden content with no discoverable indication.

Classify every candidate as:

HIGH
MEDIUM
LOW
EXPECTED_VARIATION

For each HIGH/MEDIUM candidate provide:

- screenshot ids;
- exact visual difference;
- why equivalent states should remain consistent;
- suspected failure class;
- which DOM fact should be measured to confirm it.

Do NOT call something a defect solely because it looks different.`;

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
