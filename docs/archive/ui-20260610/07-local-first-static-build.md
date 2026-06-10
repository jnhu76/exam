# Local-First & Static Build

## Requirements

The exam platform must work fully within a LAN without internet access. Every frontend resource must be bundled locally.

## Forbidden

| Forbidden | Reason |
|-----------|--------|
| CDN-hosted CSS/JS | No internet guarantee |
| Google Fonts or external fonts | No internet guarantee |
| External image URLs | No internet guarantee |
| External script includes | Security + offline |
| API base URL hardcoded to public domain | LAN deployment |

## Required

| Requirement | Implementation |
|-------------|---------------|
| Fonts | System font stack (see `02-design-tokens.md`) |
| Icons | lucide-react bundled with Vite |
| Styles | Tailwind CSS built by Vite, no runtime |
| Images | Local assets in `public/` or inline |
| API URL | Configurable via env var or runtime config |
| `npm run build` | Must produce self-contained `dist/` |
| `vite preview` | Must serve `dist/` without errors |

## Build Verification

After every UI job:

```bash
pnpm --filter web build        # Must succeed
pnpm --filter web preview      # Must serve correctly
# Check dist/ for external references:
grep -r "fonts.googleapis" dist/   # Must return nothing
grep -r "cdn" dist/                # Must return nothing
grep -r "http://" dist/            # Only API calls allowed
```

## Network Architecture

```
Browser ──→ Vite dev server (dev) or static files (prod)
         ──→ API server (LAN IP, configurable)
         ✕──→ No external internet required
```

## API Configuration

- Dev: `http://localhost:3000` (default)
- Prod: Configured via environment variable at build time or runtime
- Never hardcode a public domain as API base

## Deployment

- `dist/` is served by any static file server (nginx, caddy, express)
- API runs on a separate port or reverse-proxied
- Both run inside the organization's LAN
