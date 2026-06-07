# Design Tokens

## Colors

All colors use oklch in Tailwind v4 `@theme` block. The palette is intentionally neutral — no brand color for a multi-tenant exam platform. Organizations customize via settings, not theme.

### Semantic Tokens

| Token | Purpose | oklch Value |
|-------|---------|-------------|
| `--color-background` | Page background | `oklch(0.9857 0 0)` |
| `--color-card` | Card/surface background | `oklch(1 0 0)` |
| `--color-foreground` | Primary text | `oklch(0.20 0 0)` |
| `--color-muted-foreground` | Secondary text | `oklch(0.551 0 0)` |
| `--color-border` | Borders, dividers | `oklch(0.9235 0 0)` |
| `--color-primary` | Primary actions, links | `oklch(0.50 0.16 255)` |
| `--color-primary-foreground` | Text on primary bg | `oklch(1 0 0)` |
| `--color-destructive` | Delete, fail, error | `oklch(0.631 0.2081 25.3312)` |
| `--color-destructive-foreground` | Text on destructive bg | `oklch(1 0 0)` |
| `--color-success` | Pass, completed, saved | `oklch(0.62 0.17 150)` |
| `--color-success-foreground` | Text on success bg | `oklch(1 0 0)` |
| `--color-warning` | Caution, partial | `oklch(0.78 0.14 75)` |
| `--color-warning-foreground` | Text on warning bg | `oklch(0.20 0 0)` |

### Color Rules

- No large areas of `#000000`. Primary text uses near-black (oklch 0.20).
- Icons default to `muted-foreground` gray, not black.
- Active/selected states use `primary` color.
- Destructive actions (delete, fail) use `destructive` red.
- Success uses `success` green. Warning uses `warning` amber.

### Theme Customization

The primary color is `oklch(0.50 0.16 255)` — a darker, muted blue that feels administrative rather than SaaS-generic. Organizations can override `productName` and display settings via the Settings page, but the color theme remains consistent.

## Typography

### Font Stack

```css
font-family:
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  "PingFang SC",
  "Microsoft YaHei",
  "Noto Sans SC",
  "Source Han Sans SC",
  sans-serif;
```

No Google Fonts. No CDN fonts. All fonts must be system-local.

### Type Scale

| Element | Class | Usage |
|---------|-------|-------|
| Page title | `text-2xl font-semibold` | Top-level page headings |
| Section title | `text-lg font-medium` | Card/section headings |
| Body text | `text-sm` | Standard text |
| Secondary text | `text-sm text-muted-foreground` | Descriptions, hints |
| Label/auxiliary | `text-xs text-muted-foreground` | Badges, metadata |
| Stats number | `text-3xl font-bold` | Dashboard counters |

### Line Height

- Body text: default (1.5 for `text-sm`)
- Chinese content: ensure comfortable reading with adequate line height
- Table cells: tight line height for density

## Spacing

Use Tailwind spacing scale exclusively. No arbitrary pixel values.

| Use | Class | Value |
|-----|-------|-------|
| Card padding | `p-6` | 24px |
| Card gap | `gap-4` | 16px |
| Page padding | `p-6` | 24px |
| Section gap | `gap-6` | 24px |
| Compact padding | `p-4` | 16px |
| Tight gap | `gap-2` | 8px |

## Border Radius

| Element | Class | Value |
|---------|-------|-------|
| Card | `rounded-xl` | 12px |
| Button | `rounded-md` or `rounded-lg` | 6px / 8px |
| Badge | `rounded-full` | Pill |
| Input | Follow shadcn default | `rounded-md` |
| Dialog | `rounded-lg` | 8px |

## Shadows

Minimal shadow usage. Exam platform should feel flat and clean.

| Use | Class | Notes |
|-----|-------|-------|
| Card | `shadow-sm` | Subtle elevation only |
| Popover / Dropdown | `shadow-md` | Slightly more for floating elements |
| Dialog | `shadow-lg` | Highest elevation |

Forbidden: `shadow-xl`, `shadow-2xl`, heavy box-shadows, colored shadows.

## Icons

- Library: `lucide-react` (only)
- Default size: `size-4` (16px) for inline, `size-5` (20px) for standalone
- Default color: `text-muted-foreground` (gray)
- Active color: `text-primary`
- Stroke width: default (1.5px via lucide), do not override to `stroke-[3]`
- Forbidden: Font Awesome, Heroicons, custom SVG icons (unless lucide has no equivalent)

## Focus & Interaction

| State | Visual |
|-------|--------|
| Focus | `ring-2 ring-ring ring-offset-2` |
| Hover | `bg-accent` on interactive elements |
| Active / selected | `bg-primary/10 text-primary` |
| Disabled | `opacity-50 cursor-not-allowed` |
