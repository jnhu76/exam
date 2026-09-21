# EXAM #582 — Evidence Manifest

Audit bridge between this compact canonical record (active master tree) and the full raw evidence archive (external, not in Git). Every retained artifact is traceable below to its exact source commit.

## Raw evidence storage

```text
RAW_EVIDENCE_STORAGE:
GitHub Release research-exam-582-visual-v1
https://github.com/jnhu76/exam/releases/tag/research-exam-582-visual-v1
asset: exam-582-visual-research-evidence-v1.tar.gz (31,135,107 bytes, tar.gz)
asset SHA256: 9574aba557f9187fd8c5e94279ad4fcde529325c9258b33d0254add45c51f487
(sidecar asset exam-582-visual-research-evidence-v1.SHA256 carries the same digest)

RAW_EVIDENCE_SOURCE_SHA:
ff1b535902a8f8ee5d21545450a5774f3c1a46d4
(origin/research/582-d7-visual-ab-1 tip — the final D7 branch inherits the
merged Phase-1/D2/D4/D5 history and the unmerged D6/D3/D7 chain, so this one
tree contains the complete campaign: 529 files / 36,685,784 bytes uncompressed)

Archive layout: research/ (7 campaign directories) · harness/ (7 patrol specs +
7 builder/probe scripts) · metadata/ (CAMPAIGN-INVENTORY.txt with per-file
type/size/source-SHA, SOURCE.txt, ISSUE-582, PR-592, PR-593 exports).
```

## Per-decision provenance

"Freeze SHA" is the last commit touching the freeze record file; the contact sheets are byte-identical copies (hashes below are of the retained compact copies and equal the originals at `RAW_EVIDENCE_SOURCE_SHA`).

| | D2 | D3 | D4 | D5 | D6 | D7 |
| --- | --- | --- | --- | --- | --- | --- |
| source branch | `research/582-d2-visual-ab-1` | `research/582-d3-visual-ab-1` | `research/582-d4-visual-ab-1` | `research/582-d5-visual-ab-1` | `research/582-d6-visual-ab-1` | `research/582-d7-visual-ab-1` |
| landed on master via | stacked chain in PR #589 | PR #592 (closed unmerged) | PR #589 | PR #591 | PR #592 (closed unmerged) | PR #593 (closed unmerged) |
| freeze SHA | `42ef848fb3feb78a7fdfc60bec01a0f7932c5afc` | `e6d683cc8731030fea10632a407df270673d1c83` | `b9e3a7458470ecd56d94bef78def1b15ed4a6d8b` | `4e9d5b5a08a2cad861db7b75de6c248c2bf90db9` | `7ee7905d450e7e0232c2f69f741e172e85775373` | `ff1b535902a8f8ee5d21545450a5774f3c1a46d4` |
| freeze file original path | `docs/research/exam-582-d2-visual-ab-1/06-d2-unblind-freeze.md` | `docs/research/exam-582-d3-visual-ab-1/06-d3-unblind-freeze.md` | `docs/research/exam-582-d4-visual-ab-1/06-d4-unblind-freeze.md` | `docs/research/exam-582-d5-visual-ab-1/06-d5-unblind-freeze.md` | `docs/research/exam-582-d6-visual-ab-1/06-d6-unblind-freeze.md` | `docs/research/exam-582-d7-visual-ab-1/06-d7-unblind-freeze.md` |
| micro sheet original path | `docs/research/exam-582-d2-visual-ab-1/artifacts/D2/micro-contact-sheet.png` | `docs/research/exam-582-d3-visual-ab-1/judge/micro-contact-sheet.png` | `docs/research/exam-582-d4-visual-ab-1/judge/micro-contact-sheet.png` | `docs/research/exam-582-d5-visual-ab-1/judge/micro-contact-sheet.png` | `docs/research/exam-582-d6-visual-ab-1/judge/micro-contact-sheet.png` | `docs/research/exam-582-d7-visual-ab-1/judge/micro-contact-sheet.png` |
| macro sheet original path | `docs/research/exam-582-d2-visual-ab-1/artifacts/D2/macro-contact-sheet.png` | `docs/research/exam-582-d3-visual-ab-1/judge/macro-contact-sheet.png` | `docs/research/exam-582-d4-visual-ab-1/judge/macro-contact-sheet.png` | `docs/research/exam-582-d5-visual-ab-1/judge/macro-contact-sheet.png` | `docs/research/exam-582-d6-visual-ab-1/judge/macro-contact-sheet.png` | `docs/research/exam-582-d7-visual-ab-1/judge/macro-contact-sheet.png` |
| retained micro SHA256 | `1fd93a5c24f32e7e4c99d88185f6ad91e0e238edd671058548149674ab593a81` | `15c8cced93de24fcadb588bc9febadf9eb6cee224f829436eda4ac1e6dd734d5` | `694d5e9c73b6585083174e09e49a66bbff8dd7bc286909041bb0d47bb34be5ff` | `a42fce3dff0a38532a58094a635746e7fc903088ea4e79a8eebc46eef1a3b1af` | `dc40983d9920d1f3d7b427cbee6a29b2303b4c7a932a4b4d3ba0ea35c2704529` | `ae2a629eac1de36ef6737b124568b5e3d42f13ab9cff94c0361dcfb53d8f7207` |
| retained macro SHA256 | `8bcaae8a85ad8014e2c4e2b23d12d9a8629a344528f57589a1cb3f326276b1fe` | `6374815fc695a0c11e330d7a8eb3b648c82e5f59d56332246138fdb08d49650c` | `2cf9ac36fcebd4994fd48d890686a8a28765203f434aafb1d254ba55074d623e` | `feb810d5885f9ebf166b522332c6bea135a004aafbe3eca594daa36c9b465996` | `5287074098f66a45e4140b028b1bc57478aa49272c9927278f03987787ac7d80` | `bbe12841a456f9162b506c75e02d0d08737a154701b562e815d13b7c2846c202` |
| raw archive asset | `exam-582-visual-research-evidence-v1.tar.gz` | same | same | same | same | same |
| raw archive SHA256 | `9574aba5…c51f487` (full value above) | same | same | same | same | same |

Retained sheets in this tree: [`contact-sheets/`](contact-sheets/) (`dX-micro.png` / `dX-macro.png`). D7 additionally has four supplementary per-focus judge sheets (`judge/macro/sheet-nav-*`, `judge/micro/sheet-nav-edge-*`) preserved only in the raw archive.

## Phase-1 provenance

```text
decision:                  baseline audit (no D-decision)
source branch:             research/582-visual-correctness-font-1 (merged via PR #588)
product under test SHA:    3f5bd9c4c757daec2554de98ed06e4d4e2784c8b
evidence head SHA:         90367652cd47d9c7be5aa1e441950f52e73dc324
freeze file original path: docs/research/exam-582-visual-correctness-font-1/07-final-verdict.md
raw archive path:          research/exam-582-visual-correctness-font-1/ (89 files)
contact sheets:            none retained — Phase-1 predates the contact-sheet protocol;
                           its 4.1 MB screenshot forest is archive-only by design
```

## Campaign branches at closeout

```text
origin/research/582-d3-visual-ab-1 = e6d683cc8731030fea10632a407df270673d1c83  (kept temporarily as recovery path)
origin/research/582-d6-visual-ab-1 = 7ee7905d450e7e0232c2f69f741e172e85775373  (kept temporarily; superseded by the D3/D7 chain)
origin/research/582-d7-visual-ab-1 = ff1b535902a8f8ee5d21545450a5774f3c1a46d4  (kept temporarily)
research/582-d2-visual-ab-1 / d4 / d5 / visual-correctness-font-1: remote branches already deleted post-merge
```
