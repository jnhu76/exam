import { render } from "@testing-library/react";
import { Eye, MoreVertical, User } from "lucide-react";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listAuthorStylesheets } from "@/test/cssRules";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppIcon } from "./AppIcon";
import { DataTablePagination } from "./DataTablePagination";

/**
 * AppIcon stroke authority vs the CSS cascade (#577 B1 regression gate).
 *
 * The B1 failure class is: the SVG presentation attribute is correct
 * (`stroke-width="2.25"`) but the COMPUTED stroke is wrong, because an
 * unlayered author rule (`svg.lucide { stroke-width: 1.5 }`) matched the icon
 * — author CSS beats presentation attributes at every specificity. Asserting
 * the JSX attribute (AppIcon.test.tsx) cannot see this class of defect.
 *
 * Surface (#577): the gate covers EVERY author
 * stylesheet under web src — the full superset of the main.tsx CSS import
 * closure — not only index.css. A future recipe stylesheet declaring a broad
 * stroke selector fails this gate exactly like index.css would. It is
 * cascade-aware by construction: it extracts every stroke-width selector from
 * the real stylesheets and proves, through the browser's own selector engine
 * (element.matches), that none of them can match an AppIcon output — so
 * nothing in author CSS contests the presentation attribute and the attribute
 * IS the computed value. It also proves the primitive-internal optical rule
 * still reaches the icons those primitives own (R2).
 *
 * Ancestry ownership (#601): data-slot scoping alone does NOT
 * prove ownership — `[data-slot="pagination"] svg` also matches a
 * consumer-supplied AppIcon rendered inside the primitive (the real
 * DataTablePagination / row-action-menu ancestry). Every stroke-width
 * selector must therefore exclude AppIcon output (`:not([data-app-icon])`),
 * proven here against (a) a synthetic worst-case host chain naming every
 * data-slot in the CSS and (b) the REAL opened primitives (pagination,
 * dropdown menu, select), while primitive-owned internal icons stay matched.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", "..", "..", "src");
const STYLESHEETS = listAuthorStylesheets(SRC_ROOT).map((path) => ({
  file: relative(SRC_ROOT, path),
  css: readFileSync(path, "utf8"),
}));
const ALL_CSS = STYLESHEETS.map((s) => s.css).join("\n");

/** Extract the selectors of every rule that declares stroke-width. */
export function strokeWidthSelectors(css: string): string[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors: string[] = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(noComments)) !== null) {
    if (!/stroke-width\s*:/.test(m[2] ?? "")) continue;
    for (const sel of (m[1] ?? "").split(",")) {
      const s = sel.trim();
      if (s) selectors.push(s);
    }
  }
  return selectors;
}

/** Stroke selectors that are NOT scoped to a primitive data-slot: potential AppIcon defeaters. */
export function broadStrokeSelectors(css: string): string[] {
  return strokeWidthSelectors(css).filter(
    (sel) => !sel.includes("[data-slot="),
  );
}

/**
 * A selector may thin an AppIcon render if it matches the rendered svg (or,
 * for inherited properties, an ancestor). stroke-width IS inherited in SVG, so
 * an ancestor match would also defeat the contract — checked against a
 * representative neutral tree.
 */
export function selectorsMatchingAppIcon(
  selectors: string[],
  svg: Element,
): string[] {
  const chain: Element[] = [];
  for (let el: Element | null = svg; el; el = el.parentElement) chain.push(el);
  return selectors.filter((sel) => {
    try {
      return chain.some((el) => el.matches(sel));
    } catch {
      return true; // unparseable selector = potential threat, report it
    }
  });
}

describe("AppIcon stroke authority survives the CSS cascade (issue 577 B1)", () => {
  it("the gate covers the whole author-CSS surface (superset of the import closure)", () => {
    expect(STYLESHEETS.length).toBeGreaterThanOrEqual(8);
    expect(STYLESHEETS.map((s) => s.file)).toContain("index.css");
    const mainTs = readFileSync(join(SRC_ROOT, "main.tsx"), "utf8");
    const closure = [...mainTs.matchAll(/"(\.\/[^"]+\.css)"/g)].map((m) =>
      m[1]!.replace("./", ""),
    );
    expect(closure.length).toBeGreaterThan(0);
    for (const rel of closure) {
      expect(
        STYLESHEETS.some((s) => s.file.endsWith(rel)),
        `imported stylesheet not scanned: ${rel}`,
      ).toBe(true);
    }
  });

  it("every stroke-width selector in EVERY author stylesheet is data-slot scoped", () => {
    for (const { file, css } of STYLESHEETS) {
      const selectors = strokeWidthSelectors(css);
      for (const sel of selectors) {
        expect(
          sel.includes("[data-slot="),
          `${file}: stroke-width selector must be data-slot scoped, got: ${sel}`,
        ).toBe(true);
      }
    }
    expect(strokeWidthSelectors(ALL_CSS).length).toBeGreaterThan(0);
  });

  it("no stroke-width selector can match AppIcon output (inline/nav/state)", () => {
    const selectors = strokeWidthSelectors(ALL_CSS);
    for (const size of ["inline", "nav", "state"] as const) {
      const { container } = render(
        <div>
          <button type="button">
            <AppIcon icon={Eye} size={size} />
          </button>
        </div>,
      );
      const svg = container.querySelector("svg")!;
      // The declared contract survives only if nothing in author CSS contests
      // the presentation attribute.
      expect(selectorsMatchingAppIcon(selectors, svg)).toEqual([]);
    }
  });

  it("the primitive-internal optical rule still reaches icons the primitive owns (R2)", () => {
    const selectors = strokeWidthSelectors(ALL_CSS);
    expect(selectors).toContain(
      '[data-slot="select-trigger"] svg:not([data-app-icon])',
    );
    // Proven through the selector engine on a representative primitive tree.
    const host = document.createElement("div");
    const trigger = document.createElement("button");
    trigger.setAttribute("data-slot", "select-trigger");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "lucide lucide-chevron-down");
    trigger.appendChild(svg);
    host.appendChild(trigger);
    document.body.appendChild(host);
    try {
      expect(svg.matches('[data-slot="select-trigger"] svg')).toBe(true);
      expect(
        selectors.some((sel) => {
          try {
            return svg.matches(sel);
          } catch {
            return false;
          }
        }),
      ).toBe(true);
    } finally {
      host.remove();
    }
  });

  it("reds when a broad svg.lucide stroke override returns (in-memory mutation)", () => {
    const mutated = ALL_CSS.replace(
      '[data-slot="select-trigger"] svg',
      'svg.lucide,\n[data-slot="select-trigger"] svg',
    );
    expect(mutated).not.toBe(ALL_CSS);
    const selectors = strokeWidthSelectors(mutated);
    expect(selectors).toContain("svg.lucide");
    const { container } = render(<AppIcon icon={Eye} size="inline" />);
    const svg = container.querySelector("svg")!;
    expect(svg.matches("svg.lucide")).toBe(true);
    expect(selectorsMatchingAppIcon(selectors, svg)).toEqual(["svg.lucide"]);
  });

  it("reds when a future recipe stylesheet declares a broad stroke rule (foreign-stylesheet mutation)", () => {
    // A stylesheet imported tomorrow, not index.css — the gate must flag it.
    const foreign = "svg.lucide, .icon-row svg { stroke-width: 2 }";
    expect(broadStrokeSelectors(foreign)).toEqual([
      "svg.lucide",
      ".icon-row svg",
    ]);
    // The data-slot-scoped primitive rule stays legal.
    expect(
      broadStrokeSelectors('[data-slot="pagination"] svg{stroke-width:1.5}'),
    ).toEqual([]);
  });
});

describe("AppIcon stroke ownership vs primitive ancestry (issue #601 Step 1)", () => {
  /** Every data-slot the primitive-internal optical rule names today. */
  const HOST_SLOTS = [
    "select-trigger",
    "select-content",
    "checkbox-indicator",
    "dropdown-menu-content",
    "dialog-close",
    "sheet-close",
    "pagination",
  ];

  function expectAppIconUnmatched(container: HTMLElement) {
    const svgs = [...container.querySelectorAll("svg[data-app-icon]")];
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      expect(
        selectorsMatchingAppIcon(strokeWidthSelectors(ALL_CSS), svg),
        `an author stroke rule claims an AppIcon rendered as ${svg.getAttribute("class")}`,
      ).toEqual([]);
    }
  }

  it("the primitive optical rule excludes AppIcon output in EVERY data-slot it names (synthetic worst-case chain)", () => {
    for (const size of ["inline", "nav", "metric", "large"] as const) {
      // Nest the AppIcon under EVERY host slot at once: a selector that
      // claims consumer output under any of them reds here.
      let host: HTMLElement = document.createElement("div");
      const root = host;
      for (const slot of HOST_SLOTS) {
        const next = document.createElement("div");
        next.setAttribute("data-slot", slot);
        host.appendChild(next);
        host = next;
      }
      const { container } = render(<AppIcon icon={Eye} size={size} />, {
        container: host,
        baseElement: root,
      });
      document.body.appendChild(root);
      try {
        expectAppIconUnmatched(container);
      } finally {
        root.remove();
      }
    }
  });

  it("a data-slot svg selector WITHOUT the AppIcon exclusion reds the gate (mutation)", () => {
    const mutated = ALL_CSS.replace(
      '[data-slot="pagination"] svg:not([data-app-icon])',
      '[data-slot="pagination"] svg',
    );
    expect(mutated).not.toBe(ALL_CSS);
    const { container } = render(
      <div data-slot="pagination">
        <AppIcon icon={Eye} size="nav" />
      </div>,
    );
    const svg = container.querySelector("svg[data-app-icon]")!;
    expect(
      selectorsMatchingAppIcon(strokeWidthSelectors(mutated), svg),
    ).toContain('[data-slot="pagination"] svg');
  });

  it("real DataTablePagination ancestry: AppIcon keeps its role stroke", () => {
    const { container } = render(
      <DataTablePagination
        page={2}
        pageSize={10}
        total={50}
        onPageChange={() => {}}
      />,
    );
    expect(container.querySelector('[data-slot="pagination"]')).not.toBeNull();
    expectAppIconUnmatched(container);
  });

  it("real opened DropdownMenu: AppIcon in the trigger and in menu items keeps its role stroke", () => {
    const { container } = render(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <AppIcon icon={MoreVertical} size="inline" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>
            <AppIcon icon={User} size="inline" />
            用户操作
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    // Radix portals the content into document.body — scan the whole body.
    expectAppIconUnmatched(container);
    expectAppIconUnmatched(document.body);
  });

  it("real opened Select: primitive-owned internal icons (trigger chevron, selected-item check) stay thinned (R2)", () => {
    render(
      <Select open defaultValue="a">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">选项 A</SelectItem>
        </SelectContent>
      </Select>,
    );
    const primitiveIconSelectors = strokeWidthSelectors(ALL_CSS);
    for (const [slot, iconClass] of [
      ["select-trigger", "lucide-chevron-down"],
      ["select-content", "lucide-check"],
    ] as const) {
      const icons = [
        ...document.body.querySelectorAll(
          `[data-slot="${slot}"] svg.${iconClass}`,
        ),
      ];
      expect(icons.length, `${slot} internal ${iconClass}`).toBeGreaterThan(0);
      for (const icon of icons) {
        expect(
          primitiveIconSelectors.some((sel) => {
            try {
              return icon.matches(sel);
            } catch {
              return false;
            }
          }),
          `${slot} internal icon lost the primitive optical rule`,
        ).toBe(true);
      }
    }
  });

  it("real opened DropdownMenu still thins primitive-owned icons the primitive itself renders", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>操作</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>菜单项</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    // The primitive's own item indicator (if rendered) is primitive property;
    // what must NOT happen is AppIcon being claimed. Consumer items here have
    // no AppIcon, so no svg in the menu may carry the marker.
    const marked = document.body.querySelectorAll(
      '[data-slot="dropdown-menu-content"] svg[data-app-icon]',
    );
    expect(marked.length).toBe(0);
  });
});
