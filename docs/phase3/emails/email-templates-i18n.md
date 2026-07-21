# Email Templates & i18n — Design Note

> **Status: design note, not yet implemented.** No email templates exist today
> (all bodies are inline strings; `POST /api/email/test` uses a hardcoded
> literal). This document records the design direction for the **future** work
> of adding templates and internationalization, so that when real business
> email triggers land (password reset, invitation, result release — none exist
> yet) the foundation is already decided. Implementation is a separate job
> (likely Phase 3 Middle / L15 Notification Policy).
>
> **Companion docs:** `email.md` (M3 design spec + §Status open gaps),
> `email-config.md` (deployer/operator config guide).

---

## 1. Current state (factual)

| Concern | Current state | Evidence |
| --- | --- | --- |
| Email body source | Inline strings, no template engine | `apps/api/src/routes/email.ts:52` (`text: "This is a test email..."`) |
| Template files (`.hbs`/`.mjml`/`.html`) | None | `find` returns zero |
| `EmailType` catalog | Pre-declared 7-type union, **none wired to a template** | `packages/domain/src/email.ts:32-39` |
| Backend i18n mechanism | **None** — no i18n library in `apps/api` | `apps/api/package.json` has no i18next/react-i18next |
| Frontend i18n | **Exists**: `i18next@^26` + `react-i18next@^17`, but **single-locale** (`zh-CN` only) | `apps/web/src/i18n/locales/zh-CN.ts` (only file) |
| Product language rule | "All user-facing strings in Chinese (zh-CN)" | `AGENTS.md:323` |
| `users.email` column | **Does not exist** — no recipient source yet | `packages/db/src/schema/pg.ts` (`users` table) |

**Implication:** email i18n is **not urgent** for Phase 1 — the product is
single-locale (zh-CN) by rule, and no business email triggers exist. But the
**shape** we choose now determines how painful multi-language becomes later.
This note locks the shape so a future implementer doesn't paint us into a
corner.

---

## 2. Design principles

1. **Backend i18n is a separate concern from frontend i18n.** The web app uses
   `react-i18next` (browser, per-user, runtime locale switch). Email is rendered
   server-side at enqueue time and the rendered string is stored in the outbox
   — the receiver's MUA never runs our JS. **Do not share the frontend i18n
   bundle with email rendering.**
2. **Render once, at enqueue time.** The outbox stores the **final rendered**
   `subject` / `bodyText` (and optional `bodyHtml`), not i18n keys + params.
   Rationale: (a) the row is a complete audit record; (b) the worker never
   needs locale context; (c) a locale change does not retroactively mutate
   already-sent mail. (`notificationService.ts` already stores rendered strings.)
3. **Single source of truth for keys.** Email translation keys live in a
   dedicated backend namespace, decoupled from the web app's keys, but using
   the **same library** (i18next) for familiarity.
4. **Locale is resolved per-recipient, not global.** When multi-language
   arrives, locale comes from the recipient's user/org preference (future
   `users.locale` / `Organization.defaultLocale`), falling back to zh-CN. The
   product default stays zh-CN per `AGENTS.md`.
5. **No external/cloud translation or template service.** LAN/on-premise,
   offline-capable (`AGENTS.md`). All resources ship in-repo.

---

## 3. Recommended stack (decided, pending implementation)

| Layer | Choice | Why |
| --- | --- | --- |
| i18n engine | **`i18next` + `i18next-fs-backend`** (Node) | Same engine as the web app (one mental model); `fs-backend` loads JSON resources from disk at boot (offline, no cloud). Context7-verified: `createInstance()` gives isolated per-render instances. |
| Template (structure) | **No Handlebars/Mustache/EJS engine.** Use i18next's built-in **interpolation + plurals + context** (`t('email.password_reset.subject', { name, code })`). | Avoids a second templating DSL; i18next interpolation is enough for transactional emails. Keep it simple per `email.md` non-goal ("不做复杂邮件模板系统"). |
| Template (HTML body) | **Plain string templates**, optional `bodyHtml` built by code, not a layout engine. | No MJML/HTML compiler dependency; `bodyText` is always the portable fallback (`EmailMessage` contract). |
| Resource location | `apps/api/src/email/locales/{lng}/email.json` | Co-located with the email module; loaded once at boot. |
| Default locale | `zh-CN` (fallback) | Matches `AGENTS.md:323`. |

> **Rejected alternatives:** Handlebars (extra dependency + a second syntax);
> sharing the web app's `zh-CN.ts` (couples email to React bundle, breaks the
> "render server-side" invariant); MJML (overkill for transactional text, adds
> build step); cloud translation APIs (violates LAN/offline).

---

## 4. Proposed architecture

```
business event (e.g. password reset requested)
   │
   ▼
EmailNotificationService.enqueueXxx({ ctx, recipient, params, locale? })
   │  locale resolved: param → recipient.locale (future) → org default → zh-CN
   ▼
EmailTemplateService.render(type, locale, params)
   │   uses an isolated i18next instance (createInstance) per render call,
   │   reads apps/api/src/email/locales/{lng}/email.json (loaded at boot)
   │   returns { subject, bodyText, bodyHtml? }
   ▼
EmailOutboxRepo.create({ ..., subject, bodyText, bodyHtml })   ← RENDERED strings
   │
   ▼
worker (processDueEmails) → EmailSender.send → SMTP   ← no locale awareness here
```

**Key invariants:**

- The outbox row is **immutable after enqueue** — it holds the final rendered
  text, not keys. Sent mail is an accurate audit record.
- The worker stays **locale-agnostic** (it already exists; no change needed).
- `EmailTemplateService` is the **only** place that knows about i18n. Routes
  call `enqueueXxx`; they never call `t()` directly.

---

## 5. Resource file shape (proposed)

`apps/api/src/email/locales/zh-CN/email.json`:
```json
{
  "password_reset": {
    "subject": "重置您的考试平台密码",
    "body": "您好 {{name}}，\n\n您收到这封邮件是因为我们收到了重置密码的请求。验证码：{{code}}，10 分钟内有效。\n\n如非本人操作，请忽略此邮件。"
  },
  "exam_notification": {
    "subject": "考试通知：{{examTitle}}",
    "body_one": "您好 {{name}}，您被分配参加 {{examTitle}}。",
    "body_other": "您好 {{name}}，您被分配参加以下 {{count}} 场考试：{{examList}}。"
  }
}
```

`apps/api/src/email/locales/en/email.json` (future):
```json
{
  "password_reset": {
    "subject": "Reset your exam platform password",
    "body": "Hello {{name}},\n\nWe received a request to reset your password. Code: {{code}} (expires in 10 minutes).\n\nIf this wasn't you, ignore this email."
  }
}
```

**Conventions:**
- Keys namespaced by `EmailType` (the 7-type union in `email.ts:32-39`).
- Use i18next plurals (`_one`/`_other`, or `_0`/`_1`/`_other`) for count-sensitive bodies.
- Interpolation params are typed at the call site, not in the JSON.
- `body` is plain text; `bodyHtml` omitted unless a specific template needs it.

---

## 6. i18n setup pattern (Context7-verified)

`i18next-fs-backend` + `createInstance` (per i18next official docs) gives an
isolated instance per render, avoiding global-state races when multiple emails
of different locales are rendered concurrently in the worker:

```ts
// apps/api/src/email/templateService.ts  (sketch — not yet implemented)
import i18next from "i18next";
import FsBackend, { type FsBackendOptions } from "i18next-fs-backend";
import { fileURLToPath } from "node:url";

const localesDir = fileURLToPath(new URL("./locales", import.meta.url));

async function makeT(lng: string) {
  const instance = i18next.createInstance();
  await instance.use(FsBackend).init<FsBackendOptions>({
    lng,
    fallbackLng: "zh-CN",
    defaultNS: "email",
    backend: { loadPath: `${localesDir}/{{lng}}/{{ns}}.json` },
  });
  return instance.t;
}
```

> **Why `createInstance` and not the global `i18next.t`:** the global instance
> holds a single `lng` at a time; concurrent renders for different recipients
> would race. `createInstance` (official i18next pattern, Context7-verified)
> isolates state per render.

---

## 7. Locale resolution (future, when multi-language matters)

```
recipient.locale (users.locale — does not exist yet)
    │  null/undefined
    ▼
Organization.defaultLocale (does not exist yet — Phase 1 is zh-CN only)
    │  null/undefined
    ▼
APP_DEFAULT_LOCALE env (new, default "zh-CN")   ← deploy-level default
```

**Phase 1 reality:** every recipient is zh-CN. The resolver short-circuits to
`zh-CN` and only one locale resource file ships. The **shape** above is what
makes adding `en` later a data-only change (add `en/email.json` + populate
`users.locale`), not a code change.

**Do NOT build `users.locale` / `Organization.defaultLocale` now** — they have
no consumer (no business email flows, no UI). Add them when the first real
trigger (password reset) lands.

---

## 8. Outstanding prerequisites (gaps before any template can fire)

These are the real blockers, not i18n. From `email.md` §Status:

1. **`users.email` column** — no recipient address source exists. Any
   user-facing email (password reset, invitation, result) needs this first.
2. **A real business trigger** — none of `registration_welcome` /
   `password_reset` / `admin_created_user` / `exam_notification` /
   `grade_notification` is wired. `EmailNotificationService` is never
   instantiated by a route.
3. **Outbox worker daemon** — `processDueEmails` is test-only. Enqueued rows
   would sit pending forever without a scanner.

i18n is **not** on the critical path until those three land AND a second
locale is actually required.

---

## 9. What NOT to do (yet)

- Do NOT install Handlebars/Mustache/EJS/MJML — i18next interpolation suffices.
- Do NOT couple email templates to the web app's `react-i18next` bundle.
- Do NOT store i18n keys + params in `email_outbox` — store rendered strings.
- Do NOT build `users.locale` / multi-language UI before a single real email
  trigger exists.
- Do NOT add a cloud translation/template/email-rendering service (LAN/offline).
- Do NOT make the worker locale-aware — rendering happens at enqueue time only.

---

## 10. Open questions (for L15 Notification Policy / future grillme)

1. **Right-to-left / CJK layout** — if `ar`/`he` ever needed, HTML body layout
   direction becomes a concern. Out of scope until a real RTL requirement.
2. **Per-org template override** — should an organization override the default
   copy (e.g. branded "from name", custom signature)? Ties into Phase 4
   multi-tenant. Defer.
3. **Unsubscribe / footer** — transactional exam emails may not legally need
   an unsubscribe footer, but system_alert/marketing-ish ones might. Decide at
   L15.
4. **Locale of audit log vs email** — the audit row records `actorId`/event;
   the email row records rendered text. If a recipient's locale differs from
   the actor's, which "language" is the audit in? Answer: audit is code-level
   (event names, opaque ids) — locale-agnostic by design.

---

## 11. Cross-references

- **M3 spec + status:** `docs/phase3/emails/email.md` (§Status lists the open
  gaps that block templates).
- **Config guide:** `docs/phase3/emails/email-config.md`.
- **i18n engine docs:** i18next + i18next-fs-backend (Context7 verified:
  `createInstance` for isolated per-render instances).
- **Frontend i18n (do not couple):** `apps/web/src/lib/i18n.ts`,
  `apps/web/src/i18n/locales/zh-CN.ts`, `apps/web/package.json` (i18next /
  react-i18next).
- **EmailType catalog:** `packages/domain/src/email.ts:32-39`.
- **Notification service (enqueue surface):**
  `apps/api/src/email/notificationService.ts`.
- **Language rule:** `AGENTS.md:323` (zh-CN for user-facing strings).
