# Design Tokens

## Colors

All colors use oklch in Tailwind v4 `@theme` block. The palette is intentionally neutral — no brand color for a multi-tenant exam platform. Organizations customize via settings, not theme.

### Semantic Tokens

| Token | Purpose | Suggested oklch |
|-------|---------|-----------------|
| `--color-background` | Page background | Very light gray, ~0.98 lightness |
| `--color-card` | Card/surface background | White or near-white |
| `--color-foreground` | Primary text | Near-black, ~0.20 lightness (not pure black) |
| `--color-muted-foreground` | Secondary text | Gray, ~0.55 lightness |
| `--color-border` | Borders, dividers | Light gray, ~0.90 lightness |
| `--color-primary` | Primary actions, links | Deliberate blue (not default shadcn blue) |
| `--color-primary-foreground` | Text on primary bg | White |
| `--color-destructive` | Delete, fail, error | Red |
| `--color-success` | Pass, completed, saved | Green (to be defined) |
| `--color-warning` | Caution, partial | Amber (to be defined) |

### Color Rules

- No large areas of `#000000`. Primary text uses near-black (oklch ~0.20).
- Icons default to `muted-foreground` gray, not black.
- Active/selected states use `primary` color.
- Destructive actions (delete, fail) use `destructive` red.
- Success/warning tokens must be added to `@theme` — currently missing.

### Theme Customization

The primary color is intentionally neutral for a multi-tenant platform. J01 will finalize the exact oklch values. Organizations can override `productName` and display settings via the Settings page, but the color theme remains consistent.

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
