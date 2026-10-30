---
title: Developer & architecture
description: Where the internal architecture, contract, testing, and governance documents live.
breadcrumb:
  - text: Home
    link: /
  - text: Developer & architecture
outline: [2, 3]
---

# Developer & architecture

This portal deliberately does **not** project the internal documentation tree. It is a reader-facing product surface, not a second architecture authority. Use these pinned entry points instead — each link is fixed to the product-evidence commit and is not rendered into this site.

## Canonical internal entry points

| Topic | Canonical entry |
| --- | --- |
| Documentation index and authority map | [docs/README.md](repo:docs/README.md) |
| Cross-boundary exam semantics (EXSEM-001..020) | [exam-semantic-boundaries.md](repo:docs/architecture/exam-semantic-boundaries.md) |
| Runtime, state, submit, and grading protocol | [exam-runtime.md](repo:docs/architecture/exam-runtime.md) |
| Contracts and API policy | [docs/contracts/](repo:docs/contracts/) |
| Testing, environment, and database lifecycle | [docs/standards/testing.md](repo:docs/standards/testing.md) |
| Code quality and workspace dependency boundaries | [docs/standards/code-quality.md](repo:docs/standards/code-quality.md) |
| Current implementation status | [implementation-status.md](repo:docs/status/implementation-status.md) |
| Agent execution contract | [AGENTS.md](repo:AGENTS.md) |

## How this site is built

The site is a bounded, repo-only pilot:

- **Generator:** VitePress `1.6.4`, pinned exactly in the root `devDependencies`.
- **Source model:** a build-time allowlist projection from four canonical files (`docs/product/standard-supported-capabilities.md` and its `zh-CN` pair, `docs/guides/first-exam.md` and its `zh-CN` pair). No other repository Markdown is compiled.
- **Reader pages:** the home, overview, this page, and the FAQ are site-authored navigation pages; they do not define product capabilities.
- **Publication boundary:** no GitHub Pages, Wiki, hosting, domain, or telemetry is configured. The maintainer contract lives in `docs-site/README.md` in this repository.
