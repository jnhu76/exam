import { describe, expect, it } from "vitest";
import parser from "@typescript-eslint/parser";
import type { TSESTree } from "@typescript-eslint/utils";
import {
  collectClassNameTokens,
  findClassNameAttribute,
  tokenizeClassName,
} from "../classNameUtils";

/**
 * Shared static class-extractor tests (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §7, §17B).
 *
 * These codify `collectClassNameTokens` across every JSX expression form this
 * codebase uses, so individual rules need not repeat incomplete fixtures. The
 * extractor returns a FLAT token set — correct for rules where any single
 * matching token is independently a violation (shadow, inline-error, arbitrary
 * typography). The co-occurrence-aware `analyzeClassExpression` is the substrate
 * for the recipe-conflict rule and is tested separately.
 */

function classNameAttrValue(code: string): TSESTree.Node | null {
  const ast = parser.parse(code, {
    ecmaFeatures: { jsx: true },
    ecmaVersion: "latest",
    sourceType: "module",
  }) as TSESTree.Program;
  let attr: TSESTree.JSXAttribute | null = null;
  visit(ast, (n) => {
    if (
      !attr &&
      n.type === "JSXAttribute" &&
      n.name.type === "JSXIdentifier" &&
      n.name.name === "className"
    ) {
      attr = n as TSESTree.JSXAttribute;
    }
  });
  return attr ? (attr as TSESTree.JSXAttribute).value : null;
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

function tokens(code: string): string[] {
  return collectClassNameTokens(classNameAttrValue(code)).map((t) => t.value);
}

describe("collectClassNameTokens — expression forms", () => {
  it("string literal", () => {
    expect(
      tokens(`const X = () => <div className="shadow-sm text-sm" />;`),
    ).toEqual(["shadow-sm", "text-sm"]);
  });

  it("template literal static quasis", () => {
    expect(
      tokens(`const X = () => <div className={\`shadow-sm p-4\`} />;`),
    ).toEqual(["shadow-sm", "p-4"]);
  });

  it("template literal with embedded static literal", () => {
    expect(
      tokens(`const X = () => <div className={\`shadow-sm ${"text-sm"}\`} />;`),
    ).toEqual(expect.arrayContaining(["shadow-sm", "text-sm"]));
  });

  it("cn() string-literal args", () => {
    expect(
      tokens(`const X = () => <div className={cn("shadow-sm", "text-sm")} />;`),
    ).toEqual(expect.arrayContaining(["shadow-sm", "text-sm"]));
  });

  it("clsx() and twMerge() string-literal args", () => {
    expect(
      tokens(`const X = () => <div className={clsx("shadow-sm")} />;`),
    ).toContain("shadow-sm");
    expect(
      tokens(`const X = () => <div className={twMerge("text-sm")} />;`),
    ).toContain("text-sm");
  });

  it("logical expression (&&)", () => {
    expect(
      tokens(`const X = () => <div className={cond && "shadow-sm"} />;`),
    ).toContain("shadow-sm");
  });

  it("conditional expression", () => {
    expect(
      tokens(
        `const X = () => <div className={cond ? "shadow-sm" : "text-sm"} />;`,
      ),
    ).toEqual(expect.arrayContaining(["shadow-sm", "text-sm"]));
  });

  it("array expression", () => {
    expect(
      tokens(`const X = () => <div className={["shadow-sm", "text-sm"]} />;`),
    ).toEqual(expect.arrayContaining(["shadow-sm", "text-sm"]));
  });

  it("binary concatenation (+)", () => {
    expect(
      tokens(`const X = () => <div className={"shadow-" + "sm"} />;`),
    ).toEqual(expect.arrayContaining(["shadow-", "sm"]));
  });

  it("optional chaining", () => {
    expect(
      tokens(`const X = () => <div className={obj?.className} />;`),
    ).toEqual([]);
  });

  it("fully dynamic value yields no tokens (no false positive)", () => {
    expect(tokens(`const X = () => <div className={someVar} />;`)).toEqual([]);
    expect(tokens(`const X = () => <div className={obj.classes} />;`)).toEqual(
      [],
    );
  });
});

describe("findClassNameAttribute", () => {
  it("locates the className attribute on a JSXOpeningElement", () => {
    const ast = parser.parse(`const X = () => <div className="x" />;`, {
      ecmaFeatures: { jsx: true },
      ecmaVersion: "latest",
      sourceType: "module",
    }) as TSESTree.Program;
    let opening: TSESTree.JSXOpeningElement | null = null;
    visit(ast, (n) => {
      if (!opening && n.type === "JSXOpeningElement")
        opening = n as TSESTree.JSXOpeningElement;
    });
    expect(opening).not.toBeNull();
    const attr = findClassNameAttribute(opening!);
    expect(attr).not.toBeNull();
  });

  it("returns null when no className is present", () => {
    const ast = parser.parse(`const X = () => <div id="x" />;`, {
      ecmaFeatures: { jsx: true },
      ecmaVersion: "latest",
      sourceType: "module",
    }) as TSESTree.Program;
    let opening: TSESTree.JSXOpeningElement | null = null;
    visit(ast, (n) => {
      if (!opening && n.type === "JSXOpeningElement")
        opening = n as TSESTree.JSXOpeningElement;
    });
    expect(findClassNameAttribute(opening!)).toBeNull();
  });
});

describe("tokenizeClassName", () => {
  it("whitespace-splits and drops empties", () => {
    expect(tokenizeClassName("  shadow-sm   text-sm ")).toEqual([
      "shadow-sm",
      "text-sm",
    ]);
  });
});
