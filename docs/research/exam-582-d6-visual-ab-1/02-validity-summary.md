# 02 — Validity summary

Mapping-neutral. No X/Y → weight mapping appears in this document (sealed in `validity/variant-map.json`, which is NOT part of the judge bundle).

```text
D2 frozen baseline: PASS   (15px body/control in BOTH arms; 11 complete style pairs, 0 violations)
D4 frozen baseline: PASS   (13px/20px/500 table header in BOTH arms; 3 complete pairs, 0 violations)
D5 frozen baseline: PASS   (22px/500/12px StatusBadge under the D6 injection; 1 complete pair, 0 violations)

actual TagBadge runtime owner:
  component: apps/web/src/components/shared/TagBadge.tsx
             ([data-slot="tag-badge"], tone=neutral, geometry=compact)
  recipe:    apps/web/src/badge/recipes.css (base block + compact-table block; weight in BOTH)
  runtime selector: [data-slot="tag-badge"][data-tag-variant="compact-table"] on /admin/questions

actual production variant coverage: compact-table ONLY (Question Management tags column)
default runtime coverage: GAP — no real default-variant instance; decided from the
  actual compact-table runtime, injection still authoritative for both owner blocks

Chinese tag coverage:
  short:  安全 / 设备 / 电气 / 应急 / 基础  (rows with 1–2 tags; single-tag rows present)
  medium: 消防安全 / 设备维护 / 安全培训 / 应急处置  (single-tag and clustered rows)
  mixed:  消防安全 + 安全培训 + safety ; 应急 + 基础 + equipment + PPE ; …
  3-tag:  rendered as a 3-badge cluster (CJK + CJK + Latin row present)
  4+ / +N: rows with 4/5/6 source tags render 3 badges + "+1"/"+2"/"+3" chip
           (product maxVisible=3; identical rendering in BOTH arms, 18 badges + 3 chips each)

single-variable font-weight isolation: PASS
  (per-instance computed oracle: 18 badges/arm identical in text, order, height, size,
   line-height, padding, radius, border, colors, family; font-weight the ONLY moving property;
   cross-variable contamination: NONE — no non-TagBadge target moved in any property)
HarmonyOS 400 face: PASS  (stack contains HarmonyOS Sans SC; fonts.check true; CJK-tag-vocabulary
   subsets force-loaded, status loaded)
HarmonyOS 500 face: PASS  (fonts.check true with the same CJK sample; subset faces weight=500
   loaded; 246 registered faces, weights 400/500/700)

geometry:
  badge width: 16/18 instances identical; 2 Latin-tag instances differ by +1/+2px (Y vs X),
    identical at both viewports — causal glyph-advance geometry, not contamination
  row-height: IDENTICAL across arms at both viewports (48px single-cluster rows; 48/49px
    wrapped-cluster rows at 1100 — same in both arms)
  cluster wrapping: identical X/Y (1440: single-line 22px clusters; 1100: 22px + 48px
    two-line clusters on the same rows)
  +N position: chip widths identical; adjacent-badge gap shifts ≤1px (causal geometry)
  overflow (document/table): none in either arm at either viewport

tag-overflow non-contamination: PASS
  ([data-slot="tag-overflow"] computed font-size 12px / font-weight 400 / line-height 18px /
   padding 6px / radius 3px / color identical in BOTH arms — the chip is NOT a TagBadge and
   never received the experiment weight)
StatusBadge non-contamination: PASS
  (probed under the D6 injection on /admin/exams: 22px height, 500 weight, 12px size, 6px
   radius identical across arms)

structural: header band untouched (0 wrapped/clipped headers, identical header row height),
  action column reachable, column alignment unchanged, visible row set identical (8/8),
  rendered badge/chip counts identical (18/3)

cross-variable contamination: NONE

representation:
  1023 × 800: RESPONSIVE_REPRESENTATION_CHANGE — below lg Question Management switches to the
  MobileRecordList card representation, whose mapping OMITS the tags column (role tag-list →
  priority "low" is dropped from cards). TAGBADGE_CONTINUES = NO → 1023 EXCLUDED from D6.
  Recorded per arm in validity/structural.json + validity/geometry.json.
```

Evidence verdict: **READY_FOR_D6_MULTIMODAL_REVIEW**
