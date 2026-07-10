import { RuleTester } from "@typescript-eslint/rule-tester";
import { describe, it, afterAll } from "vitest";

/**
 * Wire the rule-tester's test framework to vitest. The repo does not enable
 * vitest `globals: true`, so we import the primitives explicitly.
 *
 * RuleTester exposes `describe`/`it`/`afterAll`/`itOnly` as static setters
 * (v8), but its public TS type does not declare the setters, so we cast
 * through a record type. This is the documented escape hatch for wiring
 * rule-tester to a non-global test runner.
 */
const wirable = RuleTester as unknown as {
  describe: unknown;
  it: unknown;
  itOnly: unknown;
  afterAll: unknown;
};
wirable.describe = describe;
wirable.it = it;
wirable.itOnly = (it as { only: unknown }).only;
wirable.afterAll = afterAll;

export const ruleTester = () =>
  new RuleTester({
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  });

export { RuleTester };
