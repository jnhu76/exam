# ADR-019 — Content Document Model: Dual-Mode Question Content and Rich Answer Authority

## Status

PROPOSED (implemented in the `feat/301-content-wysiwyg-v1` branch; pending human acceptance)

## Metadata

| Field | Value |
|---|---|
| Date | 2026-08-31 |
| Decision owners | jnhu76 |
| Supersedes | — |
| Superseded by | — |
| Related decisions | ADR-008 (submit answer freeze barrier), ADR-012 (candidate recovery contract) |

## Context

Question `content` has always been a plain text column, and `text_response`
answers were plain strings. The product needs richer prompts (lists, tables,
code, math) and, for text_response, richer candidate answers. Introducing a
general rich-text runtime (arbitrary HTML, image uploads, links) would pull
in an asset pipeline, a sanitizer surface, and storage authority questions
that are out of scope now.

Constraints that shape the decision:

- The server is the grading and time authority; persisted content must be
  server-parseable, versioned, and bounded (no unbounded arbitrary JSON).
- Search, listing, and dedup rely on `questions.content` as text.
- Answers follow the versioned/idempotent save protocol and the submit
  freeze barrier; the answer shape validation must not weaken state guards.
- The LAN/on-premise deployment must not gain cloud/CDN dependencies
  (KaTeX is bundled, not fetched).

## Decision

Adopt the **B′ additive dual-mode model** for question content:

1. **Two slots, one authority per mode.** `questions.content` TEXT stays
   mandatory; `questions.content_document` JSONB NULL is added. When
   `content_document` is NULL the question is **Plain** and `content` is the
   sole authority. When it is non-NULL the question is **Rich** and the
   document is the authority; `content` is then a server-derived
   `plainTextProjection` (search/display text) and client-supplied content
   values for rich writes are IGNORED, never stored.
2. **`contentMode` is derived, never stored.** It is a function of
   `contentDocument` nullness; no third column can drift.
3. **Closed, versioned grammar.** `ContentDocumentV1` is an exam-owned
   grammar (blocks: paragraph, bulletList, orderedList, listItem, table,
   tableRow, tableCell, codeBlock, blockMath; inlines: text, hardBreak,
   inlineMath; marks: bold, italic, underline, inlineCode). Unknown nodes are
   rejected at every write boundary. Structural limits (node count, depth,
   table shape, latex length, text/code sizes) are enforced server-side from
   centralized kernel constants.
4. **Single canonical kernel.** Parsing, normalization (deterministic and
   idempotent), limit checks, and the plain-text projection live as pure
   functions in `@exam/domain` with one canonical implementation; the wire
   Zod schema in `@exam/contracts` is compile-time-checked for type identity
   against the kernel. All rich writes pass through one server seam that
   normalizes and derives the projection.
5. **Answers.** `answerMode: "plain" | "rich"` applies to `text_response`
   only and is frozen through the QuestionSnapshot like every other grading
   input. Rich answers are validated (shape), canonicalized (normalize), and
   compared (idempotency equality) AFTER canonicalization; shape validation
   runs only for editable attempts so lifecycle guards keep precedence.
6. **Renderer is static.** The candidate/grader READ path renders documents
   with a pure-React component over the closed grammar — never Tiptap, never
   `contentEditable`, never `dangerouslySetInnerHTML` — with a controlled
   fail-safe placeholder for out-of-grammar data. The single HTML seam is
   encapsulated KaTeX rendering with `trust: false`. The Tiptap editor exists
   only on EDIT surfaces behind a lazy chunk; the plain READ path downloads
   neither Tiptap nor KaTeX.
7. **fill_blank is Plain-only** (create/update validation + publish gate).
   Import stays Plain-only in V1.

Rejected alternatives: rich HTML in `content` with server-side sanitization
(unbounded vocabulary, sanitizer drift, search degradation); a separate
`contentMode` column (drifts from the document slot); a fully generic
block JSON tree (no closed vocabulary, no bounded limits); deferring math
entirely (KaTeX is self-contained and meets the offline constraint).

## Consequences

- Images/attachments/links require an Asset authority first and remain
  future work (structured fill_blank likewise).
- Every persistence path for rich content must go through the single write
  seam; projections elsewhere are read-only derivations.
- The document grammar is versioned (`docVersion`); V2 evolution must remain
  additive or provide migration.

## Compliance notes

- Publish gates reject fill_blank+rich, `answerMode` outside text_response,
  and rich questions whose `content` diverges from the derived projection.
- Snapshot evolution is additive (`contentDocument`/`answerMode` default to
  null for legacy rows); migration is append-only.
- Audit metadata must never embed raw rich answer payloads (ADR-010
  discipline); grading reads only frozen snapshot/entry data.
