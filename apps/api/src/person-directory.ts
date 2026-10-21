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
 * With MCP OAuth off there is no directory. With it on, the directory is the
 * identity-service adapter (`person-directory.iam.ts`), and its settings are
 * checked when the API boots: a login is never served that could not map a
 * single person.
 */
import { Logger } from '@nestjs/common';
import { mcpOAuth, type ServerEnv } from '@quill/config/env';
import { DoorRefusal, DoorUnavailable } from '@quill/mcp';
import { createIamPersonDirectory, iamDirectoryConfig } from './person-directory.iam';

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
   * knows nobody by it. Throws `PersonRefused` when it knows the subject but
   * will not name one person for it (it matches several, or the person is
   * blocked); any other throw means the directory cannot be read.
   */
  personOf(subject: string): Promise<Person | null>;
}

/**
 * The directory knows a token's subject but will not name a person for it,
 * with a message the person can act on. Signing in again would not change it.
 */
export class PersonRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonRefused';
  }
}

/**
 * The configured directory, or null when MCP OAuth is off. Throws "Refusing to
 * boot" when it is on and the directory's settings are missing or malformed.
 * Nothing connects here: the directory reads on its first lookup, so the API
 * boots, and keeps serving API keys, while the identity database is down.
 */
export function createPersonDirectory(env: ServerEnv): PersonDirectory | null {
  if (!mcpOAuth(env)) return null;
  return createIamPersonDirectory(iamDirectoryConfig(env));
}

const directoryLog = new Logger('PersonDirectory');

/**
 * `directory.personOf(subject)` in the MCP door's terms: a person or nobody as
 * is; a `PersonRefused` as a 403 with its message; and a directory that cannot
 * be read as a 503 that says to retry, so an outage is neither a silent 500
 * nor a way in. The cause is logged by class and code only, never with the
 * stack or the subject.
 */
export async function lookUpPerson(
  directory: PersonDirectory,
  subject: string,
  log: (line: string) => void = (line) => directoryLog.error(line),
): Promise<Person | null> {
  try {
    return await directory.personOf(subject);
  } catch (error) {
    if (error instanceof PersonRefused) throw new DoorRefusal(error.message);
    const name = error instanceof Error ? error.name : typeof error;
    const code = (error as { code?: unknown } | null)?.code;
    log(`person directory unreadable: ${name}${typeof code === 'string' ? ` ${code}` : ''}`);
    throw new DoorUnavailable('dForms cannot check this sign-in right now. Try again in a minute.');
  }
}
