# Product Generalization Patch Notes

## Core decision

The product must be a configurable LAN/on-premise exam platform, not a hardcoded “校内考试” or “University LAN exam system”.

## Modified documents

1. `docs/phase1-plan.revised.md`
   - Adds Phase 1 scope item for platform/organization display settings.
   - Changes J4 to include Organization Settings.
   - Adds Product Generalization Decisions.
   - Adds code review checklist item for hardcoded business copy.

2. `docs/phase1-ui-design.revised.md`
   - Adds Product Generalization Tokens.
   - Adds `/admin/settings`.
   - Adds §3.20 Platform & Organization Settings page.
   - Replaces hardcoded product title/footer with `{{productName}}`, `{{productSubtitle}}`, and dynamic user display name.
   - Rewrites examples to be generic demo data.

3. `docs/code-quality.revised.md`
   - Adds Hardcoded Business Copy Guard.
   - Adds `pnpm lint:copy`.
   - Adds checklist item to prevent hardcoded deployment-specific copy.

4. `AGENTS.revised.md`
   - Rewrites project context from university-specific to generic configurable exam/assessment platform.
   - Preserves technical constraints, domain rules, and coding rules.

## Suggested implementation follow-up

Add these work items to `phase1_job4.md`:

- DB: `organization_settings` or fields on `organizations`.
- API: `GET /settings/branding`, `PATCH /admin/settings/branding`.
- Web: `BrandProvider`, `BrandHeader`, `PlatformSettingsForm`.
- Tests: fallback branding unit test, settings repository integration test, E2E test that changed product title appears on login/sidebar/exam header.
- Quality: `scripts/check-hardcoded-copy.mjs`.
