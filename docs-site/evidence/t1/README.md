# T1 typography — before/after visual evidence

Browser screenshots backing the T1 typography change. `before-` images were
captured on `origin/master` (the merged #830 pilot) before the typography
work; `after-` images on this branch after the detector-driven fixes. Both
sets use identical URLs, viewports, themes, and scroll positions; rendering
differs only in typography (the edge-fade scroll affordance discussed in the
T1 review never painted, so removing it caused no visual delta).

| File | Page | Viewport | Theme |
| --- | --- | --- | --- |
| `01` / `after-01` | /zh/ home | 1440×900 | light |
| `02` / `after-02` | /zh/guide/first-exam top | 1440×900 | light |
| `03` / `after-03` | /zh/guide/first-exam §9 | 1440×900 | light |
| `04` / `after-04` | /guide/first-exam top (EN) | 1440×900 | light |
| `05` / `after-05` | /standard/capabilities top | 1440×900 | light |
| `06` / `after-06` | /standard/capabilities §8 matrix | 1440×900 | light |
| `07` / `after-07` | /standard/capabilities top | 1440×900 | dark |
| `08` / `after-08` | /zh/guide/first-exam | 1440×900 | dark |
| `09` / `after-09` | /zh/guide/first-exam | 1280×800 | light |
| `10` / `after-10` | /zh/guide/first-exam | 390×844 | light |
| `11` / `after-11` | /zh/guide/first-exam | 320×844 | light |
| `12` / `after-12` | search modal, /zh/guide/first-exam | 1440×900 | light |
| `after-13` | keyboard focus ring, sidebar "概览" | 1440×900 | light |
| `after-14` | search results for 答案保存 | 1440×900 | light |

Platform note: captured on Linux (WSL2) Chromium. On this platform the
pre-T1 CJK chain fell through to the fontconfig default (WenQuanYi Zen Hei);
the T1 chain selects Noto Sans CJK SC here and platform fonts (PingFang SC /
Microsoft YaHei) on macOS/Windows, which were NOT executed in this
environment (`NOT_RUN` — no real Windows/macOS browser available).
