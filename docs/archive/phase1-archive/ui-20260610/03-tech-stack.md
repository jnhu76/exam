# Tech Stack

## Overview

This document records the frontend tech stack and documentation references used for the UI refactor.

## Core Stack

| Layer | Tech | Version |
|-------|------|---------|
| UI framework | React | 19.1 |
| Build tool | Vite | 6.3 |
| CSS framework | Tailwind CSS | 4.1 |
| Component system | shadcn/ui (new-york) | latest via CLI |
| Icons | lucide-react | 1.17 |
| Forms | react-hook-form + zod | current |
| Testing | Vitest + Testing Library | current |
| Monorepo | pnpm workspace | current |

## Documentation References

The following docs were consulted via Context7:

| Library | What was checked |
|---------|-----------------|
| Tailwind CSS v4 | `@theme` syntax, CSS-first config, oklch colors |
| shadcn/ui | Component installation, theming, new-york style |
| lucide-react | Icon sizing, tree-shaking |

## Key Architectural Decisions

### Tailwind CSS v4

- Uses CSS-first configuration (`@theme` block in `index.css`)
- No `tailwind.config.js` — config lives in CSS
- oklch color space for all theme tokens
- `@tailwindcss/vite` plugin for Vite integration

### shadcn/ui

- Style: `new-york`
- Base color: `neutral`
- CSS variables: enabled
- RSC: disabled (SPA, not Next.js)
- Components installed to `apps/web/src/components/ui/`
- **Do not hand-edit** generated shadcn components

### Project Structure

```
apps/web/
  src/
    components/ui/       # shadcn/ui (generated)
    components/shared/   # shared business components
    components/layout/   # layout components
    components/settings/ # settings components
    components/exam/     # exam-specific components
    components/question/ # question-specific components
    pages/               # route-level pages
    lib/                 # utilities, API client
    hooks/               # shared hooks
  index.css              # Tailwind theme entry
  components.json        # shadcn config
```

### No CDN / No External Resources

- All fonts: system font stack
- All icons: bundled with lucide-react
- All styles: built by Vite
- No Google Fonts, no CDN, no external images or scripts

## Discrepancies with Archived Doc

The archived `phase1-ui-design-archived.md` references React component paths and shadcn/ui setup. The current project **is** React + shadcn/ui, so the paths are consistent. No divergence detected.
