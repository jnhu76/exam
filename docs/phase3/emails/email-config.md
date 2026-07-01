# Email Backend Configuration Guide

> Operational reference for wiring SMTP into the exam platform. This is the
> **how-to / config** companion to the M3 design spec (`email.md`). The design
> authority is `email.md`; this document is the deployer/operator guide.
>
> **Scope:** Phase 1 single-tenant. Email config is **env-only** — there is no
> `email_config` / `smtp_config` table and none is planned for Phase 1 (see
> "Why no DB config table" below).

---

## 1. Architecture in one diagram

```
.env (EMAIL_* / SMTP_*)
        │  read once at process boot (resolveEmailConfig)
        ▼
AppRuntimeConfig.email  ──►  createEmailSender(config)
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
 DisabledEmailSender        FakeEmailSender           SmtpEmailSender
 (EMAIL_ENABLED=false)      (transport=fake)          (transport=smtp)
        │                          │                          │
       no-op              success | failure              nodemailer
       (drains outbox      deterministic test            createTransport
        to "sent")         (no network/secret)           .sendMail()
                                                        + sanitize errors
        └──────────────────────────┴──────────────────────────┘
                                   │
        routes use  fastify.emailSender.send()   (never nodemailer directly)
```

**Key invariants (enforced by code, see `email.md` §Review Standard):**

- Business code never imports nodemailer. It goes through the `EmailSender`
  abstraction (`@exam/domain` interface).
- `EMAIL_TRANSPORT` and `EMAIL_FAKE_MODE` are **strict lower-case** (`smtp`, not
  `SMTP`; `success`/`failure`). The loader fails fast on anything else.
- `SMTP_*` is read **only** when `EMAIL_TRANSPORT=smtp`.
- SMTP password is never logged / never stringified into `lastError`
  (`sanitizeEmailError` scrubs password/pass/bearer/authorization shapes).

---

## 2. Environment variables (complete reference)

All resolved by `apps/api/src/config/runtimeConfig.ts` (`resolveEmailConfig`,
lines ~428–501). Defaults match `.env.example` (lines 63–88).

### 2.1 Base email config

| Variable | Default | Required? | Allowed | Meaning |
| --- | --- | --- | --- | --- |
| `EMAIL_ENABLED` | `false` | no | `true`/`false` (truthy) | Master switch. `false` → `DisabledEmailSender` (no-op, drains outbox to `sent`). |
| `EMAIL_TRANSPORT` | `fake` | no | **`fake`** \| **`smtp`** (lower-case only) | Transport selection. |
| `EMAIL_FROM` | `no-reply@example.local` | when enabled | email string | Sender `From` address. |
| `EMAIL_FROM_NAME` | `Exam Platform` | no | string | Sender display name. |
| `EMAIL_MAX_ATTEMPTS` | `3` | no | positive int | Max send attempts before `failed`. |
| `EMAIL_RETRY_BASE_SECONDS` | `60` | no | positive int | Exponential-backoff base: `base * 2**(attempts-1)`. |

### 2.2 Fake transport config

| Variable | Default | Allowed | Meaning |
| --- | --- | --- | --- |
| `EMAIL_FAKE_MODE` | `success` | **`success`** \| **`failure`** | `success` always resolves; `failure` always throws the fixed string `"Fake email sender failure"` (for testing the failure/retry path deterministically). |

### 2.3 SMTP transport config (only used when `EMAIL_TRANSPORT=smtp`)

| Variable | Default | Required? | Meaning |
| --- | --- | --- | --- |
| `SMTP_HOST` | — | **yes** (fails fast if empty) | SMTP server hostname, e.g. `smtp.sohu.com`. |
| `SMTP_PORT` | `587` | no | TCP port. `587`=STARTTLS, `465`=implicit TLS. |
| `SMTP_SECURE` | `false` | no | `true`=implicit TLS from connect (use with 465); `false`=STARTTLS upgrade (use with 587). Strict bool. |
| `SMTP_USER` | `""` | usually | SMTP auth username (often the full email). |
| `SMTP_PASSWORD` | `""` | usually | SMTP auth password / **app-specific authorization code**. |
| `SMTP_REQUIRE_TLS` | `true` | no | When `SECURE=false`, require the server to upgrade via STARTTLS (refuse plaintext auth). Keep `true`. |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | `true` | no | Verify the TLS certificate chain. **Never set `false` in production** — only for local debugging with self-signed certs. |
| `SMTP_TLS_SERVERNAME` | `""` | no | TLS SNI/servername override. Use when `SMTP_HOST` is an IP / intranet alias / proxy but the cert is issued to a real domain. |
| `SMTP_CONNECTION_TIMEOUT_MS` | `10000` | no | TCP connect timeout. |
| `SMTP_GREETING_TIMEOUT_MS` | `10000` | no | SMTP greeting timeout. |
| `SMTP_SOCKET_TIMEOUT_MS` | `10000` | no | Inactivity socket timeout. |

> **Strict parsing:** `SMTP_PORT`, the three `*_TIMEOUT_MS`, and the two retry
> ints must be **positive integers** or the loader throws. `SMTP_SECURE`,
> `SMTP_REQUIRE_TLS`, `SMTP_TLS_REJECT_UNAUTHORIZED` use `parseStrictBool`
> (strict `true`/`false`, not truthy).

---

## 3. Safe defaults & deployment modes

### 3.1 Default / bare deployment (sends nothing)

```env
EMAIL_ENABLED=false
EMAIL_TRANSPORT=fake
EMAIL_FAKE_MODE=success
```

Behavior: no SMTP secret needed, no network access, CI needs no email config.
The outbox worker still drains queued rows to `sent` (DisabledEmailSender
resolves successfully), so pending rows never pile up forever.

### 3.2 Test environment

```env
EMAIL_ENABLED=false
EMAIL_TRANSPORT=fake
EMAIL_FAKE_MODE=success   # flip to "failure" to exercise retry/error paths
```

Tests **never** touch real SMTP, never need a secret. `.env.test.example` ships
this exact block. See `email.md` §Required Tests for the full test contract.

### 3.3 Production with real SMTP

```env
EMAIL_ENABLED=true
EMAIL_TRANSPORT=smtp
EMAIL_FROM=noreply@yourorg.com
EMAIL_FROM_NAME=Exam Platform
EMAIL_MAX_ATTEMPTS=3
EMAIL_RETRY_BASE_SECONDS=60

# Port 465 (implicit TLS) — recommended for most providers
SMTP_HOST=smtp.yourorg.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@yourorg.com
SMTP_PASSWORD=<app-specific code, NOT your mailbox login password>
SMTP_REQUIRE_TLS=true
SMTP_TLS_REJECT_UNAUTHORIZED=true
# SMTP_TLS_SERVERNAME=            # only if host != cert CN
# SMTP_CONNECTION_TIMEOUT_MS=10000
# SMTP_GREETING_TIMEOUT_MS=10000
# SMTP_SOCKET_TIMEOUT_MS=10000
```

---

## 4. Provider quick-reference

> Always prefer **app-specific / SMTP authorization codes** over the mailbox
> login password. Most consumer providers disable plain password SMTP auth.

| Provider | Host | Port / mode | Auth | Notes |
| --- | --- | --- | --- | --- |
| **Sohu** (verified working in this repo) | `smtp.sohu.com` | **465 / `SECURE=true`** | email + SMTP auth code | **587 unreachable from some networks** (conn timeout); 465 works. Use the client authorization code from Sohu mail settings, not the web login password. |
| QQ | `smtp.qq.com` | 465 / `SECURE=true` (or 587 STARTTLS) | email + SMTP auth code | Enable "SMTP service" in QQ mail settings to get the 16-char auth code. QQ anti-spam may downgrade cross-domain/same-sender-burst mail. |
| Gmail | `smtp.gmail.com` | 587 / `SECURE=false` + `REQUIRE_TLS=true` (or 465) | email + app password | Must enable 2FA + generate an **App Password**. Never use the account password. |
| 163 / NetEase | `smtp.163.com` | 465 / `SECURE=true` | email + SMTP auth code | Enable SMTP in 163 settings; uses an auth code. |
| Self-hosted (Postfix etc.) | your host | 465 or 587 per your config | per your config | If the host is an IP/intranet alias, set `SMTP_TLS_SERVERNAME` to the cert's CN. |

> **Port reachability is network-dependent.** If you get
> `EmailSendError | Timeout | code=ETIMEDOUT | command=CONN`, the port is
> blocked on your egress (common on cloud/ISP firewalls that block 587/25). See
> §6 Troubleshooting.

---

## 5. End-to-end smoke test

After configuring `.env`, verify the SMTP path end-to-end via the test-email
API (`POST /api/email/test`, Admin-only, cookie auth).

```bash
# 1. DB up + migrated + seeded (dev DB = `exam`)
pnpm db:up
pnpm db:migrate
pnpm db:seed:demo          # creates admin / admin123

# 2. Start API with a CLEAN shell env so .env wins
#    (dotenv does NOT overwrite inherited process.env values — a stale
#    EMAIL_ENABLED=false in your shell will silently override .env)
env -u EMAIL_ENABLED -u EMAIL_TRANSPORT -u EMAIL_FROM -u EMAIL_FROM_NAME \
    -u EMAIL_MAX_ATTEMPTS -u EMAIL_RETRY_BASE_SECONDS -u EMAIL_FAKE_MODE \
    -u SMTP_HOST -u SMTP_PORT -u SMTP_SECURE -u SMTP_USER -u SMTP_PASSWORD \
    -u SMTP_REQUIRE_TLS -u SMTP_TLS_REJECT_UNAUTHORIZED -u SMTP_TLS_SERVERNAME \
    -u SMTP_CONNECTION_TIMEOUT_MS -u SMTP_GREETING_TIMEOUT_MS -u SMTP_SOCKET_TIMEOUT_MS \
    pnpm --filter api dev

# 3. Login as admin, capture cookie
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  -c /tmp/admin-cookies.txt

# 4. Send a test email
curl -s -b /tmp/admin-cookies.txt \
  -X POST http://localhost:3000/api/email/test \
  -H "Content-Type: application/json" \
  -d '{"to":"recipient@example.com"}'
```

**Response interpretation:**

| `status` | Meaning |
| --- | --- |
| `sent` | SMTP server accepted the message. (Final inbox delivery still depends on the receiver's anti-spam.) |
| `disabled` | `EMAIL_ENABLED=false` OR a stale shell `EMAIL_*` var silently overrode `.env`. Server resolved to DisabledEmailSender. |
| `failed` | SMTP error. The `error` field is **sanitized** (no password). See §6. |

> **Note:** `POST /api/email/test` sends **synchronously** via
> `fastify.emailSender.send()` and bypasses the outbox — this is intentional
> (it's a connectivity probe). Real business emails must go through
> `EmailNotificationService` → `email_outbox` → worker (not yet wired; see
> `email.md` §Status).

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `status: "disabled"` despite `EMAIL_ENABLED=true` in `.env` | A stale `EMAIL_*` value in your shell `env` is overriding `.env` (dotenv never overwrites `process.env`). | Restart the API under `env -u EMAIL_ENABLED ...` (full list in §5), or run in a fresh shell. |
| API crashes at boot: `EMAIL_TRANSPORT must be "fake" or "smtp" (got: SMTP)` | `EMAIL_TRANSPORT` is **case-sensitive** — must be lower-case `smtp`, not `SMTP`. | Set `EMAIL_TRANSPORT=smtp`. |
| API crashes at boot: `EMAIL_TRANSPORT=smtp requires SMTP_HOST to be set` | `SMTP_HOST` empty while transport is smtp. | Set `SMTP_HOST`. |
| `EmailSendError \| Timeout \| code=ETIMEDOUT \| command=CONN` | TCP connect to `SMTP_HOST:SMTP_PORT` blocked/unreachable on your network. | Switch port (587↔465). Verify reachability: `timeout 8 bash -c "</dev/tcp/$HOST/$PORT"`. Cloud/ISP firewalls commonly block 587/25. |
| `EmailSendError \| ... \| code=EAUTH` | Bad credentials — wrong user, wrong password, or you used the mailbox password instead of the SMTP auth code. | Use the provider's **app-specific / SMTP authorization code**. Re-enable SMTP service in the provider's settings. |
| `EmailSendError \| ... \| code=EENVELOPE` (55x) | From address rejected, or recipient rejected by spam policy. | `EMAIL_FROM` must be an address owned/authorized by the SMTP account. For cross-domain sends, expect receiver-side filtering. |
| TLS/self-signed cert error in local dev | `SMTP_TLS_REJECT_UNAUTHORIZED=true` rejecting a self-signed cert. | **Local dev only:** temporarily set `SMTP_TLS_REJECT_UNAUTHORIZED=false`. Never in production. |
| API says `sent` but no email arrives | SMTP accepted it; receiver anti-spam dropped/quarantined it. | Check the recipient's spam folder. Check the provider's send log. Avoid `from === to` bursts and same-sender flooding. |

> **Secret hygiene:** the `error` field never contains the password
> (`sanitizeEmailError`). Logs likewise never print `SMTP_PASSWORD` or the full
> transporter config. Never paste real credentials into issues, chat, or
> committed files. `.env` is gitignored; keep secrets there.

---

## 7. Process lifecycle: dev (on-demand) vs production (always-on)

This answers "is the email dev server always running, or started on demand?"

### 7.1 Development — **on-demand**, started by you

The dev API runs under `tsx watch` (`apps/api/package.json`):

```json
"dev": "tsx watch src/server.ts"
```

- You start it explicitly (`pnpm --filter api dev` or `pnpm dev` for api+web).
- It **stays running** until you stop it (Ctrl-C / kill / terminal close). It
  is **not** a daemon — nothing auto-launches it on boot.
- On file change it **hot-reloads** (tsx watch), but env changes are **not**
  picked up — email config is read once at boot, so you must restart the
  process after editing `.env`.
- It binds `:3000`; only one instance per port.

**When you're done testing email, stop it** — there's no reason to leave it
running. The SMTP transporter (a pooled connection) is released on graceful
shutdown via the plugin's `onClose` hook (`SmtpEmailSender.close()`).

### 7.2 Production — **always-on**, managed by the container

The production image (`Dockerfile` → `docker-entrypoint.sh`) runs the compiled
server (`node dist/server.js`) as a long-lived foreground process, and
`docker-compose.yml` declares:

```yaml
app:
  build: .
  restart: unless-stopped   # always-on: auto-restarts on crash/reboot
```

- The container keeps the API (and therefore the SMTP sender) alive
  indefinitely. If the process crashes, Docker restarts it.
- Per Fastify's shutdown lifecycle (official docs, `Lifecycle.md` /
  `Server.md`): on `SIGTERM`/`fastify.close()`, the server drains in-flight
  requests (returns `503` to new ones once closing — the `return503OnClosing`
  default), then runs `onClose` hooks — which is exactly where
  `SmtpEmailSender.close()` releases the pooled transporter. So a graceful
  container stop does **not** leak SMTP connections.
- Email config is read from the container's env at boot. To change SMTP
  settings in production: update the env, then restart the container
  (`docker compose restart app`) — there is **no hot-reload** of email config.

### 7.3 Rule of thumb

| Environment | When running | Restart needed after `.env` change? | Connection lifecycle |
| --- | --- | --- | --- |
| **Dev** (`tsx watch`) | only while you started it | **yes** (kill + restart; watch reloads code, not env) | transporter created at boot, `close()`d on shutdown |
| **Prod** (Docker) | always (unless-stopped) | **yes** (`docker compose restart app`) | same; graceful `SIGTERM` drains + closes |

> There is intentionally **no email-only micro-service** to start/stop. The SMTP
> sender is a Fastify plugin decorator living inside the API process; it lives
> and dies with the API.

---

## 8. Why no DB config table? (Phase 1 decision)

Email config is **env-only** by design for Phase 1:

1. **Secret safety.** SMTP passwords in a DB increase the leak surface (DB
   backups, SQL injection, log capture). Env keeps secrets in the deploy layer
   (`.env` / container env), which is the LAN/on-premise security posture
   (`AGENTS.md`: no cloud, offline-capable).
2. **No consumer yet.** There is no Admin "email settings" UI and no multi-tenant
   sender requirement (`email.md` §Non-goals: "不做多租户发件人配置"). A config
   table with no read UI would be dead weight.
3. **Spec authority.** `email.md` Security Requirements mandate the password
   never be logged/stringified — env-only is the simplest way to honor that.

**When to revisit:** Phase 4 platformization (multi-tenant per-org senders) or
an explicit product requirement for "Admin edits SMTP online without restart."
At that point the correct shape is: encrypt secrets at rest (or keep in env),
store only non-sensitive params (`from`/`fromName`/`enabled`) in a `settings`
row. That is a separate Middle/Large job, not a Phase 1 task.

---

## 9. Verification commands

```bash
# unit + integration tests for the email stack (no real SMTP)
pnpm --filter @exam/db test -- email
pnpm --filter @exam/api test -- email
pnpm --filter @exam/api test -- outbox

# full gate
pnpm verify

# end-to-end SMTP smoke (real network) — see §5
```

---

## 10. Cross-references

- **Design spec (authority):** `docs/phase3/emails/email.md` — including
  `§Status` (delivered capabilities + open gaps: no business integration, no
  worker daemon, no `users.email` column).
- **Config loader:** `apps/api/src/config/runtimeConfig.ts` →
  `resolveEmailConfig`.
- **Senders:** `apps/api/src/email/senders.ts` (Disabled / Fake / Smtp +
  `createEmailSender` factory).
- **Fastify plugin:** `apps/api/src/plugins/email.ts` (decorate `emailSender`,
  `onClose` closes transporter).
- **Test-email route:** `apps/api/src/routes/email.ts` (`POST /api/email/test`).
- **Outbox schema/repo:** `packages/db/src/schema/pg.ts` (`emailOutbox`),
  `packages/db/src/repository/emailOutboxRepo.ts`.
- **Env template:** `.env.example` lines 63–88 (Email block).
- **Local DB discipline (env-var priority rules):** `AGENTS.md` §Local Database
  Discipline — the `env -u` pattern in §5 of this doc is the email-specific
  application of those rules.
