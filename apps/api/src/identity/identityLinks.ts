// Identity lifecycle links (#297).
//
// Same trust model as the V1 result-published action link
// (`apps/api/src/notifications/actionLink.ts`): a command-specific trusted
// builder for FIXED site-relative paths — not a generic URL whitelist
// framework (ADR-011 §7). The only interpolated component is the raw token,
// which is percent-encoded; the origin must be an absolute origin and is
// re-validated here as defense in depth (it is already enforced at boot by
// runtime config).

/** Public, unauthenticated acceptance page for staff invitations. */
export const INVITE_ACCEPT_PATH = "/invite/accept";

/** Public, unauthenticated new-password page for email password reset. */
export const RESET_PASSWORD_PATH = "/reset-password";

function assertAbsoluteOrigin(publicWebOrigin: string): string {
  const origin = publicWebOrigin.replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+$/i.test(origin)) {
    throw new Error(
      `identityLinks: PUBLIC_WEB_ORIGIN must be an absolute origin (scheme + host[+port], no path); got: ${publicWebOrigin}`,
    );
  }
  return origin;
}

/** Builds the one-time invitation acceptance URL. */
export function buildInviteAcceptLink(
  rawToken: string,
  publicWebOrigin: string,
): string {
  return `${assertAbsoluteOrigin(publicWebOrigin)}${INVITE_ACCEPT_PATH}?token=${encodeURIComponent(rawToken)}`;
}

/** Builds the single-use password reset URL. */
export function buildPasswordResetLink(
  rawToken: string,
  publicWebOrigin: string,
): string {
  return `${assertAbsoluteOrigin(publicWebOrigin)}${RESET_PASSWORD_PATH}?token=${encodeURIComponent(rawToken)}`;
}
