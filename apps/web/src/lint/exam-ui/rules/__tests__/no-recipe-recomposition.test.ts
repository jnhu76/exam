import { ruleTester } from "../../ruleTester";
import rule from "../no-recipe-recomposition";

/**
 * no-recipe-recomposition tests (UI-STABILIZATION-GOAL-1 #305).
 *
 * The rule fires only on the three proven-unambiguous recompositions:
 * text-sm+text-muted-foreground (type-secondary), text-xs+
 * text-muted-foreground (type-metadata), bare tabular-nums (type-numeric).
 * Everything else — variant-prefixed utilities, color-only muted usage,
 * recipe-selected nodes — stays out of scope.
 */
ruleTester().run("no-recipe-recomposition", rule, {
  valid: [
    // Recipes own the role once selected.
    '<p className="type-secondary">x</p>',
    '<p className="type-metadata">x</p>',
    '<p className="type-numeric text-sm">x</p>',
    // Recipe + extra utilities: conflict rule territory, not recomposition.
    '<p className="type-secondary truncate">x</p>',
    // Color-only muted usage without a recipe-owned size is allowed.
    '<span className="text-muted-foreground">x</span>',
    '<span className="text-foreground text-sm">x</span>',
    // Size without the muted color is not the recipe stack.
    '<p className="text-sm">x</p>',
    '<p className="text-xs">x</p>',
    // Variant-prefixed utilities do not fire (narrow guard).
    '<p className="md:text-sm text-muted-foreground">x</p>',
    '<p className="text-sm md:text-muted-foreground">x</p>',
    // cn() composition of a recipe is fine.
    '<p className={cn("type-secondary", cond && "truncate")}>x</p>',
    // Dynamic className without static tokens.
    "<div className={dyn}>x</div>",
    "<p>x</p>",
  ],
  invalid: [
    {
      code: '<p className="text-sm text-muted-foreground">x</p>',
      errors: [{ messageId: "useTypeSecondary" }],
    },
    {
      code: '<p className="mt-1 text-sm text-muted-foreground">x</p>',
      errors: [{ messageId: "useTypeSecondary" }],
    },
    {
      code: '<dt className="text-xs text-muted-foreground">x</dt>',
      errors: [{ messageId: "useTypeMetadata" }],
    },
    {
      code: '<span className="text-sm tabular-nums">x</span>',
      errors: [{ messageId: "useTypeNumeric" }],
    },
    {
      code: '<Td className="tabular-nums text-center">x</Td>',
      errors: [{ messageId: "useTypeNumeric" }],
    },
    {
      // cn() args are inspected like literals.
      code: '<p className={cn("text-sm", "text-muted-foreground")}>x</p>',
      errors: [{ messageId: "useTypeSecondary" }],
    },
  ],
});
