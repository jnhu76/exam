# EXAM #582 — Frozen Visual Decisions

Campaign status:

```text
VISUAL_ADJUDICATION_COMPLETE
IMPLEMENTATION_PENDING
```

| Decision | Frozen result | Runtime action |
| -------- | ------------- | -------------- |
| D2 | 15px body/control | CHANGE body/table-cell 14 → 15 |
| D3 | 6px primary control family | CHANGE Button family 8 → 6 |
| D4 | 13px / 20px / 500 table header | KEEP AS-BUILT |
| D5 | 22px StatusBadge | KEEP AS-BUILT |
| D6 | 500 TagBadge weight | CHANGE 400 → 500 |
| D7 | content-tier `var(--surface)` modal/panel background | CHANGE `var(--bg)` → `var(--surface)` |

All six decisions were produced by blind multimodal adjudication (PASS-1 verdict + PASS-2 adversarial review) over single-variable A/B evidence, then mechanically unblinded. Full adjudication records: [d2-freeze.md](d2-freeze.md) … [d7-freeze.md](d7-freeze.md). Mechanical scope of each runtime action: [IMPLEMENTATION-CONTRACT.md](IMPLEMENTATION-CONTRACT.md).

## Recorded caveats

```text
D3:
AlertDialog trigger/cancel/action semantic consumers must be included even
where Radix Slot causes data-slot="button" not to survive.

D6:
DEFAULT_VARIANT_RUNTIME_COVERAGE = GAP.
Real product evidence was compact-table.
Reconfirm if default variant becomes a real surface.

D7:
SHEET_VISUAL_SIGNAL = WEAK.
Coverage exists; sensitivity was weaker than Dialog/AlertDialog.
```

## Confidence summary

| Decision | Blind letter | PASS-2 | Final confidence | Note |
| --------- | ------------ | ------ | ---------------- | ---- |
| D2 | X (HIGH) | UPHOLD X (HIGH) | HIGH | Blinding-discipline note recorded in [d2-freeze.md](d2-freeze.md) (style-proof visibility; verdict unaffected, non-marginal) |
| D3 | Y (MEDIUM) | UPHOLD Y (MEDIUM) | MEDIUM | Difference reliably visible only in native-pixel micro evidence and continuous form composition |
| D4 | Y (HIGH) | UPHOLD Y (HIGH) | MEDIUM | Downgraded after a post-unblind directional-interpretation correction; forensic re-review supports the selected arm |
| D5 | Y (MEDIUM) | UPHOLD Y (MEDIUM) | MEDIUM | Consistent but small advantage |
| D6 | Y (MEDIUM) | UPHOLD Y (MEDIUM) | MEDIUM | Carried by three consistent evidence groups |
| D7 | Y (HIGH) | UPHOLD Y (HIGH) | HIGH | Sheet sensitivity note above does not reduce Dialog/AlertDialog confidence |

The campaign tie rule (current value wins ties) was never invoked: every decision was a clear letter win.
