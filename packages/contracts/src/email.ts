import { z } from "zod";

// ── Test Email (M3 — Email Outbox Backend Foundation) ────────────

/**
 * Request body for `POST /api/email/test`. `to` is validated as an email to
 * prevent the endpoint from becoming an open relay and to reject malformed
 * input fast.
 */
export const SendTestEmailRequestSchema = z.object({
  to: z.string().email(),
});

/** Type for the test-email request body. */
export type SendTestEmailRequest = z.infer<typeof SendTestEmailRequestSchema>;

/**
 * Response body for `POST /api/email/test`.
 *
 * - `disabled`: EMAIL_ENABLED=false — sender is a no-op.
 * - `sent`:      sender resolved successfully.
 * - `failed`:    sender rejected; `error` carries a sanitized message (no
 *               SMTP password / config).
 */
export const SendTestEmailResponseSchema = z.object({
  ok: z.boolean(),
  status: z.enum(["disabled", "sent", "failed"]),
  error: z.string().optional(),
});

/** Type for the test-email response body. */
export type SendTestEmailResponse = z.infer<typeof SendTestEmailResponseSchema>;
