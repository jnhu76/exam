/**
 * Rule factory for exam-ui rules.
 *
 * Wraps @typescript-eslint/utils' RuleCreator (RuleCreator.withoutDocs) with a
 * shared baseline suppression hook: a rule that opts into grandfathering calls
 * `maybeSuppress(...)` instead of `context.report(...)` directly. If the
 * violation's file+token signature is in the baseline, the report is dropped.
 */
import { ESLintUtils } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";
import { isGrandfathered, signature } from "./baseline";

/**
 * Minimal structural shape of an ESLint RuleContext as needed by our
 * suppression hook. We accept the context generically (any strongly-typed
 * RuleContext satisfies this structurally once we read filename / call report)
 * to avoid fighting version-specific RuleContext generics and RuleDefinition
 * variance between eslint v10 and typescript-eslint v8.
 */
type SuppressibleContext = {
  filename: string;
  report: (descriptor: {
    node: TSESTree.Node;
    messageId: string;
    data?: Record<string, unknown>;
  }) => void;
};

/**
 * Rule creator for exam-ui rules. We use RuleCreator.withoutDocs because
 * these are internal project rules (not part of the public typescript-eslint
 * docs site); a docs URL generator is not needed.
 */
export const createRule = ESLintUtils.RuleCreator.withoutDocs;

/**
 * Report a violation unless its (ruleId, file, tokens) signature is an
 * accepted existing violation in the baseline.
 *
 * `tokens` characterize THIS specific violation (e.g. ["shadow-sm"]). They are
 * normalized inside `signature()` so ordering/duplicates don't matter.
 *
 * `data` is optional message-placeholder data forwarded to context.report.
 *
 * `context` is accepted as a generic and narrowed structurally; the rule's own
 * strongly-typed RuleContext is assignable to the structural shape at runtime.
 */
export function maybeSuppress(
  context: SuppressibleContext,
  ruleId: string,
  tokens: readonly string[],
  reportNode: TSESTree.Node,
  messageId: string,
  data?: Record<string, unknown>,
): void {
  const rel = toRepoRelative(context.filename);
  const sig = signature(rel, tokens);
  if (isGrandfathered(ruleId, sig)) return;
  const descriptor: {
    node: TSESTree.Node;
    messageId: string;
    data?: Record<string, unknown>;
  } = { node: reportNode, messageId };
  if (data) descriptor.data = data;
  context.report(descriptor);
}

/** Narrow an arbitrary strongly-typed RuleContext to SuppressibleContext. */
export function asSuppressable<C>(ctx: C): SuppressibleContext {
  return ctx as unknown as SuppressibleContext;
}

/** Convert an absolute filename to a repo-root-relative posix path. */
function toRepoRelative(filename: string): string {
  const marker = "/apps/web/";
  const idx = filename.indexOf(marker);
  if (idx >= 0) {
    return filename.slice(idx + 1).replace(/\\/g, "/");
  }
  const parts = filename.split(/[\\/]/);
  return parts.slice(-3).join("/");
}
