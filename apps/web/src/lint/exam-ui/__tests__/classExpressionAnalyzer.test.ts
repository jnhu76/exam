import { describe, expect, it } from "vitest";
import parser from "@typescript-eslint/parser";
import type { TSESTree } from "@typescript-eslint/utils";
import { analyzeClassExpression } from "../classExpressionAnalyzer";

/**
 * Co-occurrence analyzer tests (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §10, §17B).
 *
 * These prove the analyzer returns the correct CO-OCCURRENCE PATHS (not a flat
 * token set), so the recipe-conflict rule does not produce cross-path false
 * positives.
 */

/** Parse a JSX expression and extract the className attribute's value node. */
function classNameExpr(code: string): TSESTree.Node | null {
  const ast = parser.parse(code, {
    ecmaFeatures: { jsx: true },
    ecmaVersion: "latest",
    sourceType: "module",
  }) as TSESTree.Program;
  // Walk to the first JSXOpeningElement's className attribute value.
  let result: TSESTree.Node | null = null;
  visit(ast, (n) => {
    if (
      n.type === "JSXAttribute" &&
      n.name.type === "JSXIdentifier" &&
      n.name.name === "className" &&
      !result
    ) {
      result = n.value as TSESTree.Node;
    }
  });
  return result;
}

function visit(node: TSESTree.Node, cb: (n: TSESTree.Node) => void): void {
  cb(node);
  for (const key of Object.keys(node)) {
    const val = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === "object" && "type" in item)
          visit(item as TSESTree.Node, cb);
      }
    } else if (val && typeof val === "object" && "type" in val) {
      visit(val as TSESTree.Node, cb);
    }
  }
}

/** Wrap code so it is a valid module with a className on a div. */
function jsx(classNameExprSrc: string): string {
  return `const X = () => <div className={${classNameExprSrc}} />;`;
}

describe("analyzeClassExpression — static literals", () => {
  it("one string literal → one path", () => {
    // A JSX attribute string literal is a JSXAttribute with value of type Literal.
    const code = `const X = () => <div className="type-metadata leading-none" />;`;
    const a = analyzeClassExpression(classNameExpr(code));
    expect(a.kind).toBe("known");
    if (a.kind === "known") {
      expect(a.alternatives).toEqual([["type-metadata", "leading-none"]]);
    }
  });

  it("template literal with static quasis and no expressions → one path", () => {
    const a = analyzeClassExpression(classNameExpr(jsx("`type-metadata p-4`")));
    expect(a.kind).toBe("known");
    if (a.kind === "known")
      expect(a.alternatives).toEqual([["type-metadata", "p-4"]]);
  });
});

describe("analyzeClassExpression — conditionals (co-occurrence)", () => {
  it("a ternary of two string literals → TWO independent paths (no cross-path conflict)", () => {
    const a = analyzeClassExpression(
      classNameExpr(jsx(`cond ? "type-metadata" : "type-metric text-3xl"`)),
    );
    expect(a.kind).toBe("known");
    if (a.kind === "known") {
      // Each branch is its own path; type-metadata and text-3xl never co-occur.
      expect(a.alternatives).toContainEqual(["type-metadata"]);
      expect(a.alternatives).toContainEqual(["type-metric", "text-3xl"]);
      expect(a.alternatives).toHaveLength(2);
    }
  });

  it("a ternary with a dynamic branch → partially-known (known branch still a path)", () => {
    const a = analyzeClassExpression(
      classNameExpr(jsx(`cond ? "type-metadata" : dynVar`)),
    );
    expect(a.kind).toBe("partially-known");
    if (a.kind === "partially-known") {
      expect(a.alternatives).toContainEqual(["type-metadata"]);
    }
  });

  it("a ternary with both branches dynamic → unknown", () => {
    const a = analyzeClassExpression(classNameExpr(jsx(`cond ? a : b`)));
    expect(a.kind).toBe("unknown");
  });
});

describe("analyzeClassExpression — cn()/clsx()/twMerge()", () => {
  it("merges cn() string-literal args into one path", () => {
    const a = analyzeClassExpression(
      classNameExpr(jsx(`cn("type-metadata", "p-4")`)),
    );
    expect(a.kind).toBe("known");
    if (a.kind === "known")
      expect(a.alternatives).toEqual([["type-metadata", "p-4"]]);
  });

  it("cn() with a conditional arg → cartesian product of paths", () => {
    const a = analyzeClassExpression(
      classNameExpr(jsx(`cn("type-metadata", cond ? "leading-none" : "p-4")`)),
    );
    expect(a.kind).toBe("known");
    if (a.kind === "known") {
      expect(a.alternatives).toContainEqual(["type-metadata", "leading-none"]);
      expect(a.alternatives).toContainEqual(["type-metadata", "p-4"]);
    }
  });

  it("cn() object-arg: static-falsy keys excluded, dynamic keys partially-known", () => {
    const a = analyzeClassExpression(
      classNameExpr(
        jsx(`cn({ "type-metadata": cond, "p-4": true, "hidden": false })`),
      ),
    );
    expect(a.kind).toBe("partially-known");
    if (a.kind === "partially-known") {
      // "hidden" is static-falsy → excluded; "type-metadata" is dynamic; "p-4" always.
      expect(a.alternatives).toEqual([["type-metadata", "p-4"]]);
    }
  });

  it("a dynamic cn() arg → partially-known (string-literal args still co-occur)", () => {
    const a = analyzeClassExpression(
      classNameExpr(jsx(`cn("type-metadata", dynVar)`)),
    );
    expect(a.kind).toBe("partially-known");
  });
});

describe("analyzeClassExpression — dynamic safety", () => {
  it("a bare dynamic identifier → unknown", () => {
    const a = analyzeClassExpression(classNameExpr(jsx(`someVar`)));
    expect(a.kind).toBe("unknown");
  });

  it("a member expression → unknown", () => {
    const a = analyzeClassExpression(classNameExpr(jsx(`obj.classes`)));
    expect(a.kind).toBe("unknown");
  });

  it("a static-fragment template literal with interpolation is NOT a complete candidate on its own", () => {
    // `text-${size}` → quasi "text-" is a fragment, not a complete utility.
    // The analyzer still returns the quasi tokens (["text-"]); the conflict rule
    // must treat incomplete fragments as non-matching (they won't parse to a
    // known utility). This test pins that the analyzer does not fabricate a
    // complete token.
    const a = analyzeClassExpression(classNameExpr(jsx("(`text-${size}`)")));
    if (a.kind !== "unknown") {
      // Whatever it produces, "text-" must not combine into a false "text-sm".
      const flat = a.alternatives.flat();
      expect(flat).not.toContain("text-sm");
    }
  });
});
