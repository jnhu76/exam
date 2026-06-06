# Dialog Overlay Z-Index Fix Report

**Date:** 2026-06-01
**Commit:** `2838b5c fix: dialog overlay covers content due to equal z-index`
**Severity:** UI bug — entire dialog rendered dark/unusable

## Problem

When any dialog (AlertDialog or Dialog) opened, the entire page turned black including the dialog content. Only the backdrop should be dark.

## Root Cause

In `AlertDialogContent` and `DialogContent`, the overlay and content both had `z-50`:

```
AlertDialogPortal
  ├── AlertDialogOverlay       (fixed inset-0 z-50 bg-black/50)
  └── AlertDialogPrimitive.Content  (fixed z-50 bg-background)
```

Radix UI renders overlay and content as **siblings** inside the same portal. When two sibling elements share the same `z-index`, CSS painting order is determined by **DOM order** — the later element paints on top. Since `AlertDialogContent` renders `<AlertDialogOverlay />` **before** `<AlertDialogPrimitive.Content>`, the overlay (later in DOM) painted on top of the content, covering it with `bg-black/50`.

Same issue existed in `DialogContent` (dialog.tsx).

## Fix

Changed content z-index from `z-50` to `z-[51]` in both components. Overlay stays at `z-50`.

| File                                          | Line | Before | After    |
| --------------------------------------------- | ---- | ------ | -------- |
| `apps/web/src/components/ui/alert-dialog.tsx` | 59   | `z-50` | `z-[51]` |
| `apps/web/src/components/ui/dialog.tsx`       | 64   | `z-50` | `z-[51]` |

## Verification

- `pnpm verify` — 8/8 tasks successful, exit code 0
- All existing tests pass (web: 104, api: 96, exam-engine: 86)
- Visual: dialog content now renders above overlay with correct `bg-background`
