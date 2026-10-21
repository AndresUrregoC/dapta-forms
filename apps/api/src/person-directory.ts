/**
 * The person directory port: who an MCP connection's token names, in the
 * terms members are keyed by.
 *
 * The identity provider's token names a person by its own subject (`sub`).
 * Members name a person by the identity service's user id (`member.external_id`)
 * and, for invitations, by email. The directory translates the first into
 * the second. It only answers WHO; which workspaces that person may act in is
 * always read from dForms' own members, on every request.
 *
 * With MCP OAuth off there is no directory. With it on, the deployment's
 * adapter is required: until one is configured the API refuses to boot, so a
 * login is never served that could not map a single person.
 */
import { mcpOAuth, type ServerEnv } from '@quill/config/env';

/** A person, as members know them. */
export interface Person {
  /** The id members carry as `external_id`: the identity service's user id. */
  id: string;
  /** The person's email, the key invitations bind by; null when the directory has none. */
  email: string | null;
}

export interface PersonDirectory {
  /**
   * The person a verified token's subject names, or null when the directory
   * knows nobody by it. Throws only when the directory cannot be read.
   */
  personOf(subject: string): Promise<Person | null>;
}

/** The configured directory, or null when MCP OAuth is off. */
export function createPersonDirectory(env: ServerEnv): PersonDirectory | null {
  if (!mcpOAuth(env)) return null;
  throw new Error(
    'Refusing to boot: MCP_OAUTH_PROVIDER is set, but this build has no person directory adapter to map a signed-in person to members.',
  );
}
