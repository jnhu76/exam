// #938 (PR3) / #937 decision 6774167661 — single authority for the
// workspace build-graph guards: the Dockerfile builder closure (C1) and the
// repo-level build-helper input coverage (C2). Plain ESM, node builtins
// only, like config/architecture-policy.mjs, so the architecture checker
// and its regression tests import the SAME implementation and no second
// copy of the grammar or coverage rules exists.
//
// Why this guard exists: the production image is built by an explicit
// per-package sequence in the Dockerfile builder stage, while the workspace
// build graph lives in the manifests. Those two descriptions can drift
// apart silently (a new buildable package the image never builds; a stale
// Dockerfile line for a package that lost its build script; a repo-level
// build helper that turbo.json does not track, so cached builds survive
// helper changes). The checker feeds real repo files into the pure
// functions below; every function receives its inputs explicitly and reads
// no process state, so counterfactual fixtures need no filesystem.
//
// Supported grammar — deliberately minimal, matching the repo's real
// forms. Anything outside the grammar is an explicit violation, never a
// silent skip: the fail-open direction is what this guard exists to kill.
//
//   Dockerfile:  RUN pnpm [flags…] --filter <exact-name> build
//               (single filter, `build` as the final token; heredoc,
//                multi-line, chained, recursive/glob-filtered and
//                non-pnpm build commands are unsupported forms)
//
//   Fail-closed heuristic for unrecognized RUN forms (#939): this guard
//   does NOT parse shell or Dockerfile exec-form semantics. Any RUN line
//   outside the grammar whose text still carries a workspace-build signal
//   — a workspace package-manager/monorepo runner token (pnpm, npm, yarn,
//   pnpmx, npx, bun, turbo, nx, lerna) AND a standalone `build` task token,
//   scanned after stripping only the wrapper punctuation (quotes, brackets,
//   commas) that a `sh -c "…"` wrapper or JSON exec form hides behind — is
//   rejected as BUILD_GRAPH_DOCKER_UNSUPPORTED: an unsupported RUN form
//   may execute a workspace build, so the closure cannot be verified.
//   Declared coverage boundary: RUN lines are classified on their own line
//   text, so a multi-line continuation or heredoc whose first line shows
//   no signal is not scanned further; wrapper forms whose runner is not a
//   workspace runner (make, gradle, cargo, custom scripts) carry no
//   workspace-build signal and stay outside this heuristic. Extending the
//   coverage is a deliberate policy change, never a silent widening.
//
//   build script: `&&`-chained simple commands; repo-level helpers may
//               only be invoked as `node ../../scripts/<file> [simple args]`
//               (variable indirection, pipes, other runners, paths escaping
//                scripts/ are unsupported forms)
//
// Out of scope (recorded as residual risks on #938, not silently claimed):
// full shell parsing, non-build helper scripts, Dockerfile COPY manifest
// coverage, coverage mechanisms other than turbo.json globalDependencies.

const HELPER_REL_PREFIX = "../../scripts/";
const SCRIPTS_DIR_PREFIX = "scripts/";

// Matches a bare "build" token, not "buildScript", "-build" or "rebuild".
const BUILD_TOKEN = /(?:^|\s)build(?:\s|$)/;
const SHELL_CHAINING = /&&|\|\||;|\|/;
const PACKAGE_NAME = /^[A-Za-z0-9@/._-]+$/;
// Simple argument tokens: no quotes, no expansion, no redirection, no globs.
const SIMPLE_ARG = /^[A-Za-z0-9@/._,:+=-]+$/;
// Plain relative path token: no leading "/", no backslash, no expansion.
// Optional "./" or "../" prefix; further dot segments match the body.
const REL_PATH_TOKEN = /^(\.\.?\/)?[A-Za-z0-9@._-][A-Za-z0-9@/._-]*$/;

// #939 fail-closed tail for unrecognized RUN forms. Wrapper punctuation
// (shell quoting, JSON exec-form brackets/commas) hides command text from
// the raw-text BUILD_TOKEN scan, which made `RUN sh -c "pnpm --filter x
// build"` and `RUN ["pnpm", "--filter", "x", "build"]` silently pass.
// Stripping ONLY that punctuation is not shell parsing — it just exposes
// the tokens the wrapper hides, so the workspace-build signal below can
// see them. INVARIANT: the signal requires BOTH a workspace runner token
// and a standalone `build` task token; lines carrying neither (apt-get,
// chmod, corepack, `npm config set`, …) stay non-build lines. Declared
// boundary (see module header): no multi-line signal chasing, and runners
// outside the workspace set (make, gradle, cargo, …) carry no signal.
const RUN_WRAPPER_PUNCTUATION = /["'`[\],]/g;
const WORKSPACE_RUNNER_SIGNAL =
  /(?:^|\s)(?:pnpm|npm|yarn|pnpx|npx|bun|turbo|nx|lerna)\b/;
const BUILD_TASK_SIGNAL = /(?:^|\s)build(?:\s|$)/;

function carriesWorkspaceBuildSignal(runContent) {
  const unquoted = runContent.replace(RUN_WRAPPER_PUNCTUATION, " ");
  return (
    WORKSPACE_RUNNER_SIGNAL.test(unquoted) && BUILD_TASK_SIGNAL.test(unquoted)
  );
}

/**
 * Read the `packages:` entries from pnpm-workspace.yaml. Only the repo's
 * real shape (top-level `packages:` followed by `- "<glob>"` items) is
 * parsed; a missing or empty section throws — the workspace member set is
 * the guard's foundation and must not be guessed.
 */
export function parseWorkspacePackageGlobs(yamlText) {
  const globs = [];
  let inPackages = false;
  for (const line of yamlText.split(/\r?\n/)) {
    if (!inPackages) {
      if (/^packages:\s*$/.test(line)) inPackages = true;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const item = /^-\s*"?([^"\s#]+)"?\s*$/.exec(trimmed);
    if (!item) break; // next top-level key ends the section
    globs.push(item[1]);
  }
  if (globs.length === 0) {
    throw new TypeError(
      "pnpm-workspace.yaml: no `packages:` glob entries found — the build-graph guard only reads the repo's real workspace shape",
    );
  }
  return globs;
}

/**
 * Expand workspace globs into member base directories. Only the repo's
 * real single-level "<dir>/*" form is supported; any other shape is an
 * unsupported form, because a silently narrowed member set would silently
 * narrow the closure the guard proves.
 */
export function expandWorkspaceGlobs(globs) {
  const bases = [];
  for (const glob of globs) {
    const match = /^([A-Za-z0-9._-]+)\/\*$/.exec(glob);
    if (!match) {
      throw new TypeError(
        `pnpm-workspace.yaml: workspace glob "${glob}" is not the supported "<dir>/*" form — extend the guard deliberately instead of silently narrowing the member set`,
      );
    }
    bases.push(match[1]);
  }
  return bases;
}

/**
 * Classify workspace members into the buildable set. A member is buildable
 * when its manifest declares a non-empty `scripts.build`; fixture packages
 * without a build script are excluded by the same rule the Dockerfile
 * uses, so they can never be mis-required into the closure. Dependency
 * edges are the declared product dependencies that resolve to workspace
 * member names — derived from the manifests, never hardcoded (#824 D2:
 * `dependencies` is the product graph; devDependencies are test scope).
 *
 * `members` is [{ dir, manifest }]; manifests must already carry a string
 * `name` (the checker fails closed on unnamed members before this call).
 */
export function deriveBuildablePackages(members) {
  const memberNames = new Set(
    members.map((member) => member.manifest.name).filter(Boolean),
  );
  return members
    .filter(
      (member) =>
        typeof member.manifest.scripts?.build === "string" &&
        member.manifest.scripts.build.trim() !== "",
    )
    .map((member) => ({
      name: member.manifest.name,
      dir: member.dir,
      buildScript: member.manifest.scripts.build,
      workspaceDependencies: Object.keys(
        member.manifest.dependencies ?? {},
      ).filter((dependency) => memberNames.has(dependency)),
    }));
}

/**
 * Parse Dockerfile RUN instructions for workspace build commands.
 * Returns { builds, unsupported } where builds are attributed
 * `--filter <name> build` entries (with their 1-based line) and
 * unsupported collects every build-bearing RUN line outside the supported
 * grammar — the caller turns those into violations, fail closed.
 *
 * Non-build RUN lines (apt-get, chmod, deploy, install) are ignored: they
 * carry no build-graph claim. Lines whose build signal is hidden behind
 * wrapper punctuation (shell quoting, JSON exec form) are NOT ignored —
 * the #939 fail-closed tail strips only the wrapper punctuation and
 * rejects any unrecognized form that still signals a workspace build, so
 * an unverifiable spelling can never pass the closure silently.
 *
 * The scan covers the whole file, not only the builder stage — any stage
 * that starts building workspace code belongs to the same artifact-chain
 * claim.
 */
export function parseDockerfileBuilds(dockerfileText) {
  const builds = [];
  const unsupported = [];
  const lines = dockerfileText.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const runMatch = /^RUN\b\s*(.*)$/i.exec(trimmed);
    if (!runMatch) return;
    const content = runMatch[1];
    const reject = (reason) => unsupported.push({ line: lineNo, reason });

    if (/^<</.test(content)) {
      reject(
        "heredoc RUN cannot be classified — spell explicit per-package commands",
      );
      return;
    }
    if (content.trimEnd().endsWith("\\") && BUILD_TOKEN.test(content)) {
      reject(
        "multi-line RUN carrying a build command cannot be attributed — one build command per RUN",
      );
      return;
    }
    if (SHELL_CHAINING.test(content) && BUILD_TOKEN.test(content)) {
      reject(
        "chained RUN containing a build command cannot be attributed — one build command per RUN",
      );
      return;
    }
    const tokens = content.split(/\s+/);
    if (tokens[0] !== "pnpm") {
      if (BUILD_TOKEN.test(content)) {
        reject(
          `non-pnpm build runner "${tokens[0]}" is not a supported Dockerfile form — builds must be explicit pnpm --filter invocations`,
        );
      } else if (carriesWorkspaceBuildSignal(content)) {
        // Fail-closed tail (#939): the build token is hidden behind wrapper
        // punctuation, so the raw-text scan above cannot see it. Rejecting
        // here is the only safe direction — an unrecognized RUN form that
        // carries workspace-build signals may execute a workspace build the
        // closure cannot account for.
        reject(
          `unrecognized RUN form may execute a workspace build ("${content.trim()}") — the guard does not parse shell or exec-form semantics, so this spelling cannot be verified against the Docker closure; spell builds as "RUN pnpm [flags] --filter <exact-name> build"`,
        );
      }
      return;
    }
    const parsed = parsePnpmCommand(tokens);
    if (parsed.kind === "build") {
      builds.push({ name: parsed.name, line: lineNo });
    } else if (parsed.kind === "unsupported") {
      reject(parsed.reason);
    }
    // kind "other": a pnpm command that claims no build (install, deploy,
    // exec…) — not a build-graph statement.
  });
  return { builds, unsupported };
}

/**
 * One pnpm invocation from a RUN line (tokens[0] === "pnpm").
 * Supported build shape: `pnpm [flags] --filter <exact-name> build` with
 * exactly one --filter, `build` as the FINAL token, and an exact
 * (non-glob, non-variable) filter name. A pnpm command mentioning a build
 * anywhere else is an unsupported form, not an ignore: trailing arguments
 * after `build` are a build claim the grammar cannot attribute.
 */
function parsePnpmCommand(tokens) {
  const unsupported = (reason) => ({ kind: "unsupported", reason });
  let filterValue = null;
  let filterCount = 0;
  let i = 1;
  for (; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "--filter") {
      i += 1;
      if (i >= tokens.length) return unsupported("--filter without a value");
      filterValue = tokens[i];
      filterCount += 1;
      continue;
    }
    if (token.startsWith("--filter=")) {
      return unsupported(
        `"${token}" — the --filter=<name> spelling is not a supported form; use "--filter <name>"`,
      );
    }
    if (token.startsWith("-")) continue;
    break; // first positional token; i points at it
  }
  const rest = tokens.slice(i);
  const mentionsBuild = rest.includes("build");
  if (filterCount === 0) {
    if (rest.length > 0 && rest[rest.length - 1] === "build") {
      return unsupported(
        `recursive/root pnpm build ("pnpm ${rest.join(
          " ",
        )}") has no per-package attribution — builds must be explicit --filter invocations`,
      );
    }
    if (mentionsBuild) {
      return unsupported(
        `pnpm command "${rest.join(
          " ",
        )}" carries a build token in an unsupported position`,
      );
    }
    return { kind: "other" };
  }
  if (filterCount > 1) {
    return unsupported(
      "multiple --filter flags cannot attribute the build to one package",
    );
  }
  if (rest.length === 0 || !mentionsBuild) {
    return { kind: "other" }; // deploy, install, exec, …
  }
  if (rest[rest.length - 1] !== "build") {
    return unsupported(
      `build token in an unsupported position ("pnpm --filter ${filterValue} ${rest.join(
        " ",
      )}") — only a final "build" token is supported`,
    );
  }
  const between = rest.slice(0, -1);
  if (between.some((token) => !token.startsWith("-"))) {
    return unsupported(
      `unexpected positional token(s) ${JSON.stringify(
        between.filter((token) => !token.startsWith("-")),
      )} between --filter and build — only "pnpm [flags] --filter <name> build" is supported (the "run" spelling included)`,
    );
  }
  if (!PACKAGE_NAME.test(filterValue) || /[*?[\]]/.test(filterValue)) {
    return unsupported(
      `--filter "${filterValue}" is not an exact package name — glob or variable filters have no per-package attribution`,
    );
  }
  return { kind: "build", name: filterValue };
}

/**
 * C1 closure comparison: bidirectional set equality between the buildable
 * workspace packages and the Dockerfile build sequence, duplicate
 * detection, and topological-order validation against the declared
 * workspace dependency edges. Returns violation strings.
 */
export function dockerfileClosureFindings({ buildable, builds, unsupported }) {
  const findings = [];
  for (const item of unsupported) {
    findings.push(
      `Dockerfile:${item.line}: BUILD_GRAPH_DOCKER_UNSUPPORTED — ${item.reason}`,
    );
  }
  const firstBuild = new Map();
  for (const build of builds) {
    if (firstBuild.has(build.name)) {
      findings.push(
        `Dockerfile:${build.line}: BUILD_GRAPH_DOCKER_DUPLICATE — "${
          build.name
        }" is built more than once (first at line ${
          firstBuild.get(build.name).line
        }) — the builder sequence must contain each package exactly once`,
      );
      continue;
    }
    firstBuild.set(build.name, build);
  }
  const buildableByName = new Map(buildable.map((pkg) => [pkg.name, pkg]));
  for (const pkg of buildable) {
    if (!firstBuild.has(pkg.name)) {
      findings.push(
        `BUILD_GRAPH_DOCKER_CLOSURE — workspace package "${pkg.name}" (${pkg.dir}) has a build script but the Dockerfile never builds it; the production image build closure has drifted from the workspace (#938 C1)`,
      );
    }
  }
  for (const build of builds) {
    if (!buildableByName.has(build.name)) {
      findings.push(
        `Dockerfile:${build.line}: BUILD_GRAPH_DOCKER_STALE_ENTRY — Dockerfile builds "${build.name}" but no workspace manifest declares a build script for it`,
      );
    }
  }
  // Order: every package must build after all of its buildable workspace
  // dependencies. Edges come from the manifests, so a new dependency that
  // reorders the image build is caught without any hardcoded sequence.
  const position = new Map();
  builds.forEach((build, index) => {
    if (!position.has(build.name)) position.set(build.name, index);
  });
  for (const pkg of buildable) {
    const pkgPos = position.get(pkg.name);
    if (pkgPos === undefined) continue; // missing closure already reported
    for (const dependency of pkg.workspaceDependencies) {
      const depPos = position.get(dependency);
      if (depPos !== undefined && depPos > pkgPos) {
        findings.push(
          `BUILD_GRAPH_DOCKER_ORDER — "${pkg.name}" is built before its workspace dependency "${dependency}" in the Dockerfile builder sequence`,
        );
      }
    }
  }
  // Cycles: a dependency cycle has no valid linearization at all.
  const remainingEdges = new Map();
  for (const pkg of buildable) {
    const edges = pkg.workspaceDependencies.filter((dependency) =>
      buildableByName.has(dependency),
    );
    remainingEdges.set(pkg.name, new Set(edges));
  }
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [name, edges] of remainingEdges) {
      if (edges.size === 0) {
        remainingEdges.delete(name);
        for (const edgesOf of remainingEdges.values()) edgesOf.delete(name);
        progressed = true;
      }
    }
  }
  if (remainingEdges.size > 0) {
    findings.push(
      `BUILD_GRAPH_DOCKER_CYCLE — workspace dependency cycle among ${[
        ...remainingEdges.keys(),
      ]
        .sort()
        .join(", ")}: no valid Dockerfile build order exists`,
    );
  }
  return findings;
}

/**
 * C2 parse: repo-level helper references inside one package's build
 * script. Supported form: `&&`-chained simple commands where a helper is
 * invoked as `node ../../scripts/<file> [simple args]`; the path is
 * normalized so dot-segment spellings cannot dodge the scripts/ scoping.
 * Anything else that reaches into scripts/ — or any node invocation whose
 * path the grammar cannot classify — is an unsupported form: coverage
 * cannot be proven for shapes the guard does not understand, and
 * unsupported must never masquerade as covered.
 */
export function parseBuildScriptHelpers(packageName, buildScript) {
  const references = [];
  const unsupported = [];
  const reject = (reason) => unsupported.push({ packageName, reason });
  if (/[;|`$]/.test(buildScript)) {
    reject(
      "build script uses shell features the guard cannot classify (command chaining beyond &&, pipes, variable/subcommand expansion) — helper input coverage cannot be proven",
    );
    return { references, unsupported };
  }
  if (/[<>]/.test(buildScript)) {
    reject(
      "build script uses redirection the guard cannot classify — helper input coverage cannot be proven",
    );
    return { references, unsupported };
  }
  for (const rawSegment of buildScript.split("&&")) {
    const segment = rawSegment.trim();
    if (segment === "") continue;
    const tokens = segment.split(/\s+/);
    if (tokens[0] !== "node") {
      if (segment.includes(SCRIPTS_DIR_PREFIX)) {
        reject(
          `"${segment}" references a repo-level helper without the supported "node ../../scripts/<file>" invocation — coverage cannot be proven`,
        );
      }
      continue;
    }
    if (tokens.length < 2) {
      reject(`"${segment}" invokes node without a script path`);
      continue;
    }
    const scriptToken = tokens[1];
    const normalized = normalizeRelPath(scriptToken);
    if (normalized === null) {
      reject(
        `"${scriptToken}" is not a plain relative path — helper input coverage cannot be proven`,
      );
      continue;
    }
    if (normalized === "../../scripts") {
      reject(`"${scriptToken}" does not name a single file under scripts/`);
      continue;
    }
    if (!normalized.startsWith(HELPER_REL_PREFIX)) {
      // Not a repo-level helper reference from this package. A package-
      // local module is fine; a scripts/ reach in another spelling is not.
      if (scriptToken.includes(SCRIPTS_DIR_PREFIX)) {
        reject(
          `"${segment}" reaches scripts/ in an unsupported spelling — the supported form is "node ../../scripts/<file>"`,
        );
      }
      continue;
    }
    const helperPath = normalized.slice(HELPER_REL_PREFIX.length);
    if (helperPath === "" || !PACKAGE_NAME.test(helperPath)) {
      reject(`"${scriptToken}" does not name a single file under scripts/`);
      continue;
    }
    for (const arg of tokens.slice(2)) {
      if (!SIMPLE_ARG.test(arg)) {
        reject(
          `"${segment}" passes the unclassifiable argument ${JSON.stringify(
            arg,
          )} to the repo-level helper — simple literal arguments only`,
        );
      }
    }
    references.push({
      packageName,
      helperPath: SCRIPTS_DIR_PREFIX + helperPath,
    });
  }
  return { references, unsupported };
}

/**
 * Normalize a whitespace-free relative path token without touching the
 * filesystem, KEEPING leading ".." segments: "../../scripts/x.mjs" stays
 * "../../scripts/x.mjs", while inner dot segments resolve, so
 * "../shared/../../scripts/x.mjs" normalizes onto the repo helper path and
 * "../../scripts/../package.json" normalizes outside scripts/ and is
 * rejected by the caller's prefix check. Returns null for anything that is
 * not a plain relative path (absolute paths, expansion, backslashes, URL
 * schemes) — the caller treats null as an unsupported form, never silent.
 */
function normalizeRelPath(token) {
  if (!REL_PATH_TOKEN.test(token) || token.includes("\\")) return null;
  const segments = [];
  for (const segment of token.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0 || segments[segments.length - 1] === "..") {
        segments.push("..");
      } else {
        segments.pop();
      }
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/**
 * C2 coverage: every repo-level helper a build script references must be
 * covered by a turbo.json globalDependencies entry, otherwise turbo's
 * cached builds survive helper changes and the cache serves stale inputs.
 * Coverage is provable only for an exact path entry or a narrow scripts/
 * glob; anything else counts as uncovered and names the missing
 * registration in the finding.
 */
export function helperCoverageFindings({ references, globalDependencies }) {
  const findings = [];
  for (const reference of references) {
    const covering = globalDependencies.find((entry) =>
      coversHelperEntry(entry, reference.helperPath),
    );
    if (!covering) {
      findings.push(
        `BUILD_GRAPH_HELPER_UNREGISTERED — ${
          reference.packageName
        } build script uses repo-level helper "${reference.helperPath}" but turbo.json globalDependencies does not cover it: the helper can change while cached builds keep serving stale output (#938 C2). Register the exact path (or a scripts/ glob) in turbo.json.`,
      );
    }
  }
  return findings;
}

function coversHelperEntry(entry, helperPath) {
  if (typeof entry !== "string") return false;
  if (entry === helperPath) return true;
  if (entry === "scripts/**") return helperPath.startsWith(SCRIPTS_DIR_PREFIX);
  if (entry === "scripts/*") {
    return (
      helperPath.startsWith(SCRIPTS_DIR_PREFIX) &&
      !helperPath.slice(SCRIPTS_DIR_PREFIX.length).includes("/")
    );
  }
  return false;
}
