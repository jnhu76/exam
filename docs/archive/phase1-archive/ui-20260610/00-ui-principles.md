# UI Principles

## Context

This is a **LAN/on-premise exam platform**. It runs inside organizations — schools, training centers, enterprises, certification bodies. It must work without internet. It must feel like a reliable internal tool.

## Design Goal

> 干净的教务后台，而不是炫酷的营销页面。

Every visual decision should serve clarity and predictability. The interface should feel like a well-organized filing cabinet, not a magazine spread.

## Keywords

- Simple — minimal cognitive load
- Clear — information hierarchy at a glance
- Stable — no surprises, consistent patterns
- Low-noise — no decorative distractions
- Localized — all resources bundled, zero CDN
- Maintainable — consistent tokens, predictable component patterns

## Forbidden Patterns

| Forbidden | Reason |
|-----------|--------|
| SaaS landing page aesthetic | This is an internal tool |
| Sci-fi dashboard aesthetic | Not a command center |
| Glassmorphism / backdrop-blur | Distraction in an exam context |
| Large gradients | Visual noise |
| Heavy drop shadows | Clutter |
| Complex animations | Unnecessary in a forms-heavy tool |
| Multiple icon libraries | Pick one (lucide) and stick with it |
| Google Fonts / external CDN fonts | System must work offline |
| CDN-hosted scripts or styles | LAN deployment, no internet guarantee |
| Large areas of pure black `#000` | Harsh on eyes, use near-black instead |
| Default shadcn blue as primary | Too generic; tokens should be intentional |

## Allowed Patterns

- Flat colors with subtle differentiation
- Minimal shadows on cards and popovers only
- Consistent 4px/8px spacing grid
- Single icon library (lucide-react)
- System font stack for Chinese readability
- Clear hover/focus/active states using design tokens
- Status colors only where they convey meaning (pass/fail, warning, error)

## Design References

- shadcn/ui neutral theme as the visual base
- Government/enterprise admin panels (clean, functional)
- Examination system UIs from established vendors
