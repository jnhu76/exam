# Contributing to Exam

Thank you for your interest in contributing. This guide covers the basics
of finding work, setting up your environment, and submitting changes.

## Finding Issues

All active work is tracked in GitHub Issues. Pick a specifically authorized
**OPEN** Issue, which owns its task scope and ordering. The closed
[#584](https://github.com/jnhu76/exam/issues/584) is no longer current
execution authority; no universal successor was automatically promoted.
Use [`docs/roadmap/post-mvp-issues.md`](docs/roadmap/post-mvp-issues.md)
for navigation and [`docs/roadmap/current.md`](docs/roadmap/current.md)
for phase status.

Before starting work, read the Issue body and confirm it is still
reconciled with current master — stale Issues are updated rather than
blindly implemented.

## Development Setup

See [`docs/development/README.md`](docs/development/README.md) for full
setup instructions (prerequisites, local database, dev servers, seed
data, testing, E2E).

Quick version:

```bash
git clone <repo-url> exam && cd exam
pnpm install
pnpm db:up            # start PostgreSQL + Redis (Docker)
pnpm db:migrate       # run migrations
pnpm db:seed          # seed test users
pnpm dev              # start API + Web dev servers
```

## Pull Request Process

1. Create a branch from `master` with a descriptive name.
2. Implement the change following the Issue's scope, acceptance
   criteria, and non-goals.
3. Write or update tests as needed (see
   [`docs/standards/testing.md`](docs/standards/testing.md)).
4. Run the verification gates before pushing:

   ```bash
   pnpm verify:static   # format + lint + typecheck + contract checks
   pnpm verify          # full: static + coverage + build
   ```

5. Open a PR against `master`. Link the Issue it addresses.
6. Keep the Issue and PR in sync — update the Issue if scope or
   decisions change.

## Direct development loop (#689)

After editing `packages/domain/src`, you can run **direct** Vitest in the
`@exam/contracts` or `@exam/api` project without first building domain:

```bash
pnpm --filter @exam/contracts exec vitest run src/examProfile.test.ts
pnpm --filter @exam/api exec vitest run src/domainSourceResolution.test.ts
```

Those two Vitest projects resolve the exact `@exam/domain` package-root import
to `packages/domain/src/index.ts` via the test-only
`vitest.sourceAliases.ts`. Direct typecheck is source-fresh the same way: the
`typecheck` script of both projects uses `tsconfig.typecheck.json`, whose
`paths` maps the exact `@exam/domain` entry to domain source, so `tsc` gate
evidence never comes from a stale `dist/index.d.ts`. Production Node and
TypeScript package entries **still resolve to dist**, as intended: builds
(`tsc`) keep using `tsconfig.json`, and the editor TS server reads
`tsconfig.json` too, so editor diagnostics for domain symbols can trail one
domain build behind until `pnpm --filter @exam/domain build` runs. These
exceptions do not mean a direct run automatically rebuilds **other** workspace
dependencies; use the root `pnpm test` / `pnpm verify` Turbo commands for the
complete build-first, CI-equivalent graph.

## Verification Requirements

Every PR must pass `pnpm verify:static` locally before submission.
The CI pipeline runs the same gates plus coverage and E2E.

If a gate fails and the failure is pre-existing (not introduced by your
change), note it in the PR description with evidence. Do not suppress
failures with `|| true` or skip gates.

## Code Quality

The code quality rules, dependency graph constraints, and AI coding
guidelines live in
[`docs/standards/code-quality.md`](docs/standards/code-quality.md).
Key principles:

- No `any` types or type assertions that bypass design.
- PostgreSQL is the only supported database.
- All data access goes through repositories with explicit `RequestContext`.
- Domain types come from `@exam/domain`, contracts from `@exam/contracts`.
- Follow KISS; choose the minimum correct design for the current need.

## Documentation Authority

The repository uses a layered authority model:

| Fact type | Authority |
| --- | --- |
| Production behavior | Code, config, schema, migrations |
| Executable verification | Tests, gates, CI |
| Architectural decisions | Accepted ADRs in `docs/adr/` |
| Product invariants | `docs/SPEC.md` |
| README | Project introduction and navigation only |

**README is not a runtime authority.** If README conflicts with current
production behavior, README is stale.

Do not duplicate authoritative facts across documents. One detailed
fact, one authoritative home.

## Scope Discipline

- One Issue per PR when practical.
- Do not expand scope beyond the Issue's acceptance criteria.
- Found unrelated bugs? File a new Issue; do not embed fixes in an
  unrelated PR.
- Follow the long-term modification principles in
  [`AGENTS.md`](AGENTS.md) (KISS, no new abstraction layers, no
  duplicate truth sources).

## AI / Agent Development

If you are an AI coding agent, you must read and follow
[`AGENTS.md`](AGENTS.md) before making any changes. It defines work
modes, authorization boundaries, database safety, testing strategy,
and modification principles.

## License

Exam is licensed under the
[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

Contributions are accepted under the project's applicable AGPL-3.0
terms. Any future commercial licensing or contributor-rights model
requires a separate, explicit governance and legal decision and is not
established by this document.

## Questions?

Open a Discussion on GitHub or check the existing documentation in
[`docs/`](docs/).
