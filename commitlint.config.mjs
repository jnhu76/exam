// Single authority for commit message rules. Consumed by the commit-msg
// hook (@commitlint/cli), the pre-push gate (scripts/check-commit-messages.mjs)
// and the CI "Commit messages" job — no second rule implementation exists.
// Spec: docs/standards/commit-messages.md

const SCOPE_PATTERN = /^[a-z][a-z0-9-]*$/;

export default {
  extends: ["@commitlint/config-conventional"],

  // INVARIANT: commitlint's default wildcard ignores (merge commits,
  // `Revert "..."`, semver chore) must never bypass validation — a formal
  // merge commit is subject to type(scope): subject like any other commit.
  // CI-only integration merges ("merge already-remote history into the
  // branch") are exempted topologically by scripts/check-commit-messages.mjs,
  // never by message shape.
  defaultIgnores: false,

  // fixup!/squash! are tolerated at commit time for interactive-rebase
  // workflows; the pre-push and CI gates lint with `ignores: []` and reject
  // them (see docs/standards/commit-messages.md §autosquash).
  ignores: [(commit) => /^(fixup|squash)!/.test(commit)],

  plugins: [
    {
      rules: {
        // scope must match [a-z][a-z0-9-]*; absence is covered by scope-empty
        "exam/scope-pattern": (parsed) => {
          const { scope } = parsed;
          if (scope == null) {
            return [true, ""];
          }
          return [
            SCOPE_PATTERN.test(scope),
            `scope must match ${SCOPE_PATTERN} (e.g. "exam", "otel", "api")`,
          ];
        },
      },
    },
  ],

  rules: {
    "header-max-length": [2, "always", 72],
    "scope-empty": [2, "never"],
    "exam/scope-pattern": [2, "always"],
    // No natural-language case heuristics on the subject: they misfire on
    // Chinese text and acronyms (the spec deliberately omits them).
    "subject-case": [0],
  },
};
