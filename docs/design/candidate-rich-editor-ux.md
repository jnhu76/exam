# Candidate Rich Editor UX — Interaction Contract (Phase U)

Status: FROZEN for #669 Phase U (candidate Rich editor UI/UX initiative).
Authority: #669 (execution), #677 (usability evidence baseline), #679 (Math UX, absorbed), #674 (lock presentation, absorbed), #675 (closed alignment baseline — preserved).

This document freezes **behavior, not pixels**. It deliberately does NOT restate the Rich
semantic contract — the persistence authority remains
[`docs/architecture/rich-content-semantic-contract.md`](../architecture/rich-content-semantic-contract.md)
(ADR-019) and `ContentDocumentV1`. This UI consumes established backend semantics; it never
reopens them. The command registry defined here is a UI catalogue, not a second semantic
authority: it must not encode grammar, normalization, or persistence validation.

Live evidence baseline (before-state, captured 2026-10-04 @ master `34f294ec` through real
Chrome CDP): `/tmp` campaign artifacts; summary in PR description. #677 findings F2/F3/F5/F6/F7/F9
were all re-confirmed live; F4 is partially stale (Tab inside lists already indents on current
Tiptap 3.30.5 — nesting works, focus does not escape) and is closed by verifying the as-built
keyboard contract + persistence, not by re-implementing it.

---

## 1. Command model

One web-owned command catalogue (`apps/web/src/components/shared/content/rich-editor/commands.ts`):

```ts
type EditorCommandKind = "toggle" | "action" | "insert";
type EditorCommandDescriptor = {
  id: EditorCommandId;        // typed union, one member per supported command
  group: "history" | "inline" | "list" | "insert";
  labelKey: I18nKey;          // candidate-facing name (zh-CN authoritative)
  icon: LucideIcon;           // rendered through AppIcon (size/stroke authority)
  shortcut?: string;          // ONLY when genuinely bound in the editor
  kind: EditorCommandKind;
  isActive(editor): boolean;  // toggles only
  isEnabled(editor): boolean; // availability in current context
  execute(editor): void;      // editor mechanism via Tiptap commands
};
```

Invariants:

- `command semantic → descriptor → toolbar/menu presentation`. No JSX button owns private
  command behavior.
- Every command's execute() must produce state inside the existing Tiptap extension allow-list
  (= frozen grammar). The catalogue adds no node, mark, or attribute.
- The catalogue never reads or validates ContentDocument structure — mapping stays in
  `contentAdapter.ts`.

### Command set (complete — nothing else is exposed)

| Group | Command | Grammar target | Kind |
| --- | --- | --- | --- |
| history | undo / redo | (editor history) | action |
| inline | bold / italic / underline / inlineCode | marks | toggle |
| list | bulletList / orderedList | bulletList / orderedList | toggle |
| insert | formula | inlineMath / blockMath | action |
| insert | codeBlock | codeBlock | toggle |
| insert | table | table(2×2, no header) | action |
| contextual (table) | addRowBefore/After, addColumnBefore/After, deleteRow, deleteColumn, deleteTable | table structure | action |

Explicitly NOT exposed (canonical V1 cannot persist them): heading, blockquote, horizontal
rule, link, image, video, attachment, raw HTML, table merge/split/header-row/column-resize,
MathML/MathJSON/AsciiMath persistence. `CANDIDATE_VISIBLE_SUPPORTED_CONTENT ==
CANONICAL_PERSISTABLE_SEMANTICS` is the binding constraint (U gates).

## 2. Toolbar information architecture

Single compact command bar rendered from the registry (`RichEditorToolbar`):

```text
[undo] [redo] │ [bold] [italic] [underline] [inline-code] │ [bullet] [ordered] │ [formula] [code-block] [table]
```

- Icon-first. Universally recognizable formatting actions are icon-only; every icon-only
  control carries an accessible name (`aria-label`), a tooltip, and a visible focus ring.
- Candidate-facing labels never mention implementation terms (no inlineMath/blockMath/
  ProseMirror/Tiptap/AST). Formula = 公式；code block = 代码块；table = 表格.
- Group separators are visual only; the toolbar has `role="toolbar"` + `aria-label`.
- Shortcuts appear in tooltips ONLY where the binding genuinely exists
  (undo Mod+Z, redo Mod+Y/Mod+Shift+Z, bold Mod+B, italic Mod+I, underline Mod+U,
  inline code Mod+E, bullet Mod+Shift+8, ordered Mod+Shift+7); `aria-keyshortcuts` set on
  those buttons. No invented shortcuts.

### Responsive behavior (no uncontrolled wrap)

- Wide (≥ 640px viewport, Tailwind `sm:`): one primary row, all groups visible, `flex-nowrap`.
- Narrow (< 640px viewport): high-frequency controls remain in the row (undo/redo, inline group,
  list group, formula); 代码块 and 表格 move into a "更多" overflow menu (`MoreHorizontal`,
  DropdownMenu). The row never wraps into a second strip; the writing canvas stays primary.
- The table contextual bar (below) is a deliberate contextual strip that appears only while
  the caret is inside a table — it is not toolbar wrap.
- Implementation is viewport-breakpoint-driven (`sm:` classes), not JS width measuring.

## 3. Active / disabled semantics (#677 F3)

- `useEditorState({ editor, selector })` is THE reactive mechanism: every selection change
  and document change re-evaluates all command states in one subscription; no document-mutation-only
  updates, no forced React rerenders.
- Toggle commands (bold, italic, underline, inlineCode, bulletList, orderedList, codeBlock)
  render `aria-pressed` + a visual active state that follows the caret, including
  collapsed-selection stored-mark state.
- Commands unavailable in context (e.g. undo with empty history) render disabled
  (`disabled` + sanctioned disabled pattern), never hidden.
- The formula toolbar command is disabled only when the editor is not editable; the
  inline/display mode CHOICE inside the formula surface is separately constrained by the
  persistence context (§5.1) — the two restrictions are distinct mechanisms.

## 4. Keyboard contract

- Undo/redo: Tiptap `UndoRedo` (`@tiptap/extensions`), default platform bindings
  (Mod+Z; Mod+Y / Mod+Shift+Z). No custom history stack. Save/network state never enters
  editor history. Toolbar undo/redo disabled when `canUndo/canRedo` false.
- Lists: Tab indents (sink) / Shift+Tab outdents (lift) a list item where legal. Where the
  sink is ILLEGAL (e.g. the first/only item — `sinkListItem` cannot act), the editor-level
  keymap SWALLOWS the keystroke instead of letting the browser default move focus out of
  the editor. Verified live on master `34f294ec` (U-01 evidence): first-item Tab currently
  escapes to page controls — the editor-scoped guard closes exactly this class. Focus must
  never land on 交卷/标记本题 or any page control from a list Tab/Shift+Tab. Shift+Tab with
  an illegal lift is swallowed symmetrically. Outside lists/tables, Tab keeps ordinary
  accessibility traversal — the editor does NOT globally trap Tab.
- Tables: Tiptap table Tab semantics (move cells) unchanged.
- List-item-start Backspace: stock ProseMirror/Tiptap behavior retained (no bespoke keymap);
  undo/redo now makes the merge class recoverable (closes the harmful half of #677 F10).
- Formula surface: Escape cancels; confirm/cancel keyboard-reachable; focus returns to the
  originating formula / previous selection (Radix Dialog focus management).
- Formula atom in the document: carries an accessible name (公式 + latex hint) and opens the
  formula surface on click or on Enter while the atom is selected, so the re-edit path is
  keyboard-discoverable, not pointer-only.
- Existing math-settlement keyboard invariants (C12–C15, `SettleMathSelectionAfterOperation`)
  are untouched.

## 5. Formula workflow (#679)

One deliberate toolbar action 公式 opens ONE coherent formula surface (Dialog). The old
always-visible raw LaTeX input and the two low-level insertion buttons are removed.

### 5.1 Surface

- Visual math field: **MathLive** `<math-field>` (donor rationale: MIT, actively maintained,
  visual fraction/sqrt/superscript/subscript/sum/integral entry, LaTeX import/export,
  built-in keyboard, IME-safe, React-compatible web component). **Lazy-loaded via dynamic
  `import("mathlive")` the first time the surface opens** — the read path and the editor
  bundle never download it eagerly.
- Expert mode: a secondary "LaTeX 源码" disclosure within the same surface edits the SAME
  canonical latex string with live preview. Expert source mode does not create a second
  validation oracle; persistence legality stays with the backend contract.
- Mode choice 行内 / 独立显示 maps to inlineMath / blockMath **only** where the canonical
  adapter preserves them: inside a list item or table cell, blockMath downgrades to
  inlineMath on save (#673 C14) — therefore 独立显示 is DISABLED in those contexts with a
  short explanation instead of offering a silently-downgrading operation.
- Preview uses the production KaTeX rendering seam (same options as MathRenderer);
  malformed-but-authority-legal latex shows a clear render warning while remaining
  saveable (D5 source preservation). The UI never claims successful render when KaTeX
  failed, and never rejects persistence merely because preview rendering failed.

### 5.2 Insert / re-edit / no-op

- Insert (new): confirm → `insertInlineMath` / `insertBlockMath` with the latex value →
  existing settlement guarantees position the caret.
- Re-edit (existing): clicking a rendered formula — or pressing Enter with the formula
  atom selected via keyboard — opens the SAME surface pre-filled with the node's current
  latex and mode; confirm updates the SAME node (`updateInlineMath` / `updateBlockMath`).
  Delete-and-reinsert is not the normal workflow.
- No-op policy: the surface tracks the originally opened latex AND whether the user actually
  edited the field. Confirm applies a transaction only when the field was edited AND the
  resulting latex differs from the original. MathLive's import-time normalization never
  reaches the document by itself: opening a formula and confirming without edits produces
  no transaction, no dirty state, no save, no version bump.
- Typed `$…$` / `$$…$$` input rules: the current Mathematics input rules are RETAINED as-is
  (single-conversion, settlement-guarded per C15); no second shorthand parser is introduced.
  Decision recorded per #679; behavior covered by existing + new regressions.

## 6. Table workflow (#677 F7)

- Toolbar 表格 inserts the same 2×2 headerless table as today.
- While the caret is inside a table, a contextual bar appears with the supported structure
  operations: add row above/below, add column left/right, delete row, delete column, delete
  table — all via current Tiptap table commands; all persist through the canonical adapter.
- Merge/split/header controls are not offered (grammar is rectangular, unspanned).
- Existing Tab-moves-cells and Tab-at-final-cell behavior is retained.

## 7. Writing affordances (#677 F9)

- Placeholder 请输入答案 via Tiptap `Placeholder` (`@tiptap/extensions`) — editor-only
  projection, never persisted content.
- Character count: NOT shipped. No ContentDocument-independent counting semantic exists for
  math/table/codeBlock content and no product limit depends on such a number; shipping an
  ambiguous counter would be a misleading number. Recorded as an optional, explicitly
  scoped follow-up (count = plainTextProjection length is the only candidate semantics, and
  it is not required today).

## 8. Save / recovery UX (#677 F6)

- The four truthful states are preserved: 未保存/保存中/已保存/保存失败 — "已保存" appears
  only after the SaveAnswer ACK; protocol semantics untouched.
- The save-failed retry affordance is driven by the authoritative per-question failure set
  (`useSubmitFlush.failedQuestionIds`), not by the global chip alone: a later successful save
  of ANY question must not hide the fact that other questions remain failed. The global
  chip keeps its existing per-save state; the retry affordance renders while the failure set
  is non-empty.
- Browser `online` event triggers automatic retry: failed questions are re-scheduled through
  THE EXISTING save orchestration (`saveAnswer` → debounced coordinator → flush), preserving
  baseVersion / clientSeq / replay semantics and the latest editor snapshot. No second save
  implementation exists; retry is a re-invocation of the same path. Retry while a save
  execution legitimately bails (attempt no longer saveable) resolves the pending UI state
  instead of leaving 保存中 stuck; a stale-scope (route-changed) bail touches nothing.
- Retry (automatic or manual) while still offline keeps failing honestly — no false 已保存.

## 9. Locked-state presentation (#674)

The overlay stops being a single `isLocked` copy block. It branches on the authoritative
`view.lockReason` (already projected by `deriveTakeExamView`; no new backend field):

| lockReason | Presentation |
| --- | --- |
| `deadline` | 考试时间已到 copy; 正在自动提交 ONLY while the auto-submit flow is actually in flight (`autoSubmitFailed` keeps its retry affordance). When the deadline lock is terminal (auto-submit not in flight — e.g. the page was opened after expiry), the overlay offers a neutral next action (返回考试列表 / 查看结果 per visibility) instead of a bare dead end. |
| `disrupted` | Recovery copy (连接中断/作答已暂停/可恢复) + a valid next action: direct 恢复考试 retry when `canResume`, otherwise navigation back to the exam list (ADR-012 recovery authority). NEVER claims 考试时间已到 or 正在自动提交. |
| `submitted` | Terminal copy (考试已结束/答案已提交) + result/list navigation per existing visibility. |
| `voided` | Terminal copy (考试已作废). |
| absent | Neutral ended copy without auto-submit claims. |

- No business truth is inferred in the UI; the snapshot remains the authority. The disrupted
  branch is reachable in product only through real interruption; E2E may use the documented
  `HEARTBEAT_TIMEOUT_MS` fixture ONLY to exercise that branch (invalid-environment results
  are not product truth, per #674 §触发环境).

## 10. Accessibility contract

- Toolbar: implements the ARIA toolbar pattern — `role="toolbar"` with a labelled boundary,
  ONE tab stop (roving tabindex), Arrow/Home/End traversal between controls; toggle state
  via `aria-pressed`; disabled state exposed; tooltips never the only accessible name
  (`aria-label` carries the name). A single tab stop keeps Tab-past-toolbar viable for
  keyboard users moving between prompt and canvas.
- Formula surface: accessible name (dialog title); focus enters intentionally; Escape
  closes; confirm/cancel keyboard-reachable; focus restored to the originating formula or
  prior selection (Radix Dialog focus management); render-warning state announced
  (role="status").
- Formula atom: accessible name in the document (see §4), Enter-activated editing path.
- Save state: failure uses icon + text + tone (never color alone); status changes are
  announced by the existing indicator semantics.
- Locked overlay: reason text announced (role="alert" region); recovery action
  keyboard-reachable; the disabled editor keeps no trapped focus.
- Table contextual bar: reachable by keyboard, labelled controls.

## 11. Visual system

Existing design system only: semantic tokens, Button/Tooltip/DropdownMenu/Dialog primitives
from `components/ui`, AppIcon (inline 16px stroke 1.5) as the only Lucide entry, existing
h-9 control geometry, existing radius/spacing. No arbitrary hex/shadows/copied reference
branding. The editor area keeps `surface-content` semantics.

## 12. Performance

- Toolbar state via one `useEditorState` selector — no whole-document canonicalization on
  selection changes.
- MathLive imported only when the formula surface first opens; `RichContentEditor` remains
  inside the existing lazy editor chunk.
- Command catalogue is a module-level constant; never rebuilt per keystroke.

## 12a. Implementation obligations (dependency surface)

Named dependency additions sanctioned by this contract and the #679 donor evaluation:
`@tiptap/extensions@3.30.5` (UndoRedo, Placeholder — pinned to the installed Tiptap
version) and `mathlive` (visual math field; lazy-imported). No other runtime dependencies
are authorized by this phase.

## 13. Non-goals

New backend protocol semantics; new ContentDocument version; new QuestionType; #678
capability composition; new persistence formats; symbolic math grading / CAS; attachments;
new Rich grammar nodes; general application redesign; teacher/admin UI; char count (see §7);
bespoke list Backspace keymaps; a universal command framework beyond the single catalogue.

## 14. Browser acceptance scenarios

The permanent E2E/campaign matrix (B1–B20 in the phase brief) exercises at minimum:
basic writing + save/reload fidelity; formatting active-state transitions; undo/redo across
typing/formatting/list/formula; nested list Tab/Shift+Tab + persistence (focus never lands
on 交卷); visual inline/display formula insert + save/reload; formula re-edit; formula
no-op (no version bump); expert LaTeX mode; malformed-latex warning without data loss;
formula in prose/list/table-cell contexts (no silent blockMath downgrade); table row/column
ops + save/reload; offline save → auto-retry after `online` without new keystrokes; manual
retry while offline stays honest; disrupted vs deadline vs submitted lock copy; real
deadline behavior; final-edit submit; viewport matrix 1440/1280/1024/~768; keyboard-only
operation; a11y names/states snapshot.

Gates: U-A…U-Z as frozen in the phase brief (#669 Phase U).
