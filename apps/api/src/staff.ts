/**
 * Who the deployment's STAFF are: people whose email is on one of the
 * domains `IAM_STAFF_DOMAINS` lists. Staff may search every workspace and
 * enter any of them as an admin, through an access grant
 * (`member.access_grant = 'staff'`).
 *
 * The one rule every surface applies: the web app's workspace switcher (the
 * email the identity service's token carries) and MCP connections (the email
 * the person directory holds for the person). A pure function, so the rule
 * cannot drift between them.
 */

/**
 * The identity service's workspace id behind a local account's
 * `external_id`, or null for an account the identity service does not own
 * (none, or a local-only `local:`/`dev:`/`legacy:` id). Only such a
 * workspace can be granted into, or written upstream.
 */
export function upstreamWorkspaceIdOf(externalId: string | null | undefined): string | null {
  if (!externalId || externalId.startsWith('local:') || externalId.startsWith('dev:') || externalId.startsWith('legacy:')) return null;
  return externalId;
}

/**
 * True when `email`'s domain (after the last `@`, trimmed, lowercased) is
 * exactly one of `domains` (lowercase, no `@`). No email, an email without a
 * domain, or no domains listed: false, so an unset list makes nobody staff,
 * never everybody, and `x@notexample.com` is never staff of `example.com`.
 */
export function isStaffEmail(email: string | null | undefined, domains: readonly string[] | undefined): boolean {
  if (!domains?.length || !email) return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return domain.length > 0 && domains.includes(domain);
}
