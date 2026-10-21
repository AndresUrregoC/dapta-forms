/**
 * The identity-service adapter of the person directory port: reads, never
 * writes, the identity service's own database to translate the identity
 * provider's subject into the identity service's user id, the id members carry
 * as `external_id`. The only place that knows that database's layout.
 *
 * The rules are the ones the sibling MCP server applies to the same people:
 *   1. the live user row whose provider id is the subject;
 *   2. only if there is none, the live users any session links to the subject
 *      (accounts migrated without the id on their row). Not one to one: a
 *      browser shared by two people links one subject to both, so more than
 *      one person is refused, never resolved to the newest session;
 *   3. neither: nobody (null). A deleted user is nobody; an inactive or
 *      blocked one is refused.
 * Every query casts the parameter, never the column, so the indexes on the
 * provider id columns serve it.
 *
 * Settings come from the environment (`IAM_DB_*`, see `iamDirectoryConfig`);
 * no host, database, schema or role of the hosted deployment is written here.
 */
import postgres from 'postgres';
import type { ServerEnv } from '@quill/config/env';
import { PersonRefused, type Person, type PersonDirectory } from './person-directory';

/** Where the identity service's database is, and the read-only role to read it as. */
export interface IamDirectoryConfig {
  host: string;
  port: number;
  database: string;
  /** The schema that holds `users` and `sessions`. */
  schema: string;
  user: string;
  password: string;
  /** TLS on the connection. Off only for a database on a loopback host. */
  tls: boolean;
}

type IamDirectoryEnv = Pick<
  ServerEnv,
  'IAM_DB_HOST' | 'IAM_DB_PORT' | 'IAM_DB_NAME' | 'IAM_DB_SCHEMA' | 'IAM_DB_USER' | 'IAM_DB_PASS'
>;

const REQUIRED = ['IAM_DB_HOST', 'IAM_DB_NAME', 'IAM_DB_SCHEMA', 'IAM_DB_USER', 'IAM_DB_PASS'] as const;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
/** A plain Postgres identifier: what the schema name is quoted as, and nothing else. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
/** A host name, an IPv4 address or an IPv6 one (bare or bracketed): no scheme, port, path or credentials. */
const HOST = /^(\[[0-9A-Fa-f:.]+\]|[0-9A-Fa-f]*:[0-9A-Fa-f.]*:[0-9A-Fa-f:.]*|[A-Za-z0-9.-]+)$/;

/**
 * The identity database settings, checked: every value present (the port
 * defaults to 5432), the schema a plain identifier, the port a port. Throws
 * "Refusing to boot" naming what is wrong, so a directory that could never
 * read is not served. TLS is on unless the host is a loopback host.
 */
export function iamDirectoryConfig(env: IamDirectoryEnv): IamDirectoryConfig {
  const value = (name: (typeof REQUIRED)[number]) => (env[name] ?? '').trim();
  const missing = REQUIRED.filter((name) => !value(name));
  if (missing.length > 0) {
    throw new Error(
      `Refusing to boot: MCP_OAUTH_PROVIDER is set, so the person directory needs ${missing.join(', ')} (read-only access to the identity database).`,
    );
  }
  const rawHost = value('IAM_DB_HOST');
  if (!HOST.test(rawHost)) {
    throw new Error(`Refusing to boot: IAM_DB_HOST must be a bare host name or address, got ${JSON.stringify(rawHost)}.`);
  }
  const host = rawHost.replace(/^\[(.*)\]$/, '$1');
  const schema = value('IAM_DB_SCHEMA');
  if (!IDENTIFIER.test(schema)) {
    throw new Error(`Refusing to boot: IAM_DB_SCHEMA must be a plain schema name (letters, digits, _), got ${JSON.stringify(schema)}.`);
  }
  const rawPort = (env.IAM_DB_PORT ?? '').trim();
  const port = rawPort ? Number(rawPort) : 5432;
  if (!/^\d+$/.test(rawPort || '5432') || port < 1 || port > 65_535) {
    throw new Error(`Refusing to boot: IAM_DB_PORT must be a port number, got ${JSON.stringify(rawPort)}.`);
  }
  return {
    host,
    port,
    database: value('IAM_DB_NAME'),
    schema,
    user: value('IAM_DB_USER'),
    // The password is used as given: a secret may legitimately end in a space.
    password: env.IAM_DB_PASS ?? '',
    tls: !LOOPBACK.has(host.toLowerCase()),
  };
}

/** Bounds of the adapter, defaults for production; specs shorten them. */
export interface IamDirectoryOptions {
  /** At most this many connections at once (default 4): one lookup per MCP request, index-backed. */
  maxConnections?: number;
  /** A query unanswered after this long fails the lookup (default 5 s), so a stuck database never holds a request. */
  queryTimeoutMs?: number;
}

export interface IamPersonDirectory extends PersonDirectory {
  /** Close the pool (specs, shutdown). */
  close(): Promise<void>;
}

interface UserRow {
  id: string;
  email: string | null;
  is_active: boolean | null;
  blocked: boolean;
}

const COLUMNS = 'u.id::text AS id, u.email, u.is_active, (u.blocked_at IS NOT NULL) AS blocked';

/** How the adapter's connections show in `pg_stat_activity`. */
const APPLICATION_NAME = 'dforms-person-directory';

export function createIamPersonDirectory(config: IamDirectoryConfig, options: IamDirectoryOptions = {}): IamPersonDirectory {
  const queryTimeoutMs = options.queryTimeoutMs ?? 5_000;
  // Lazy: nothing connects until the first lookup, so the API boots (and keeps
  // serving API keys) while the identity database is down.
  const sql = postgres({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.user,
    password: config.password,
    // 'require' encrypts and never falls back to plain text; the certificate
    // is not checked against a CA, as the sibling MCP server reads it.
    ssl: config.tls ? 'require' : false,
    max: options.maxConnections ?? 4,
    connect_timeout: 5,
    idle_timeout: 60,
    max_lifetime: 30 * 60,
    connection: { application_name: APPLICATION_NAME },
    onnotice: () => {},
  });
  const schema = sql(config.schema);

  /** `query`, failed and cancelled on the server once it runs past the timeout. */
  async function timed(query: postgres.PendingQuery<UserRow[]>): Promise<UserRow[]> {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void Promise.resolve(query.cancel()).catch(() => {});
        reject(new Error(`The identity database did not answer within ${queryTimeoutMs} ms.`));
      }, queryTimeoutMs);
    });
    try {
      return await Promise.race([query, late]);
    } finally {
      clearTimeout(timer);
    }
  }

  const byUser = (subject: string) => sql<UserRow[]>`
    SELECT ${sql.unsafe(COLUMNS)}
    FROM ${schema}.users u
    WHERE u.workos_user_id = ${subject}::text
      AND u.deleted_at IS NULL
    LIMIT 2`;
  const bySession = (subject: string) => sql<UserRow[]>`
    SELECT DISTINCT ${sql.unsafe(COLUMNS)}
    FROM ${schema}.sessions s
    JOIN ${schema}.users u ON u.id = s.user_id
    WHERE s.workos_user_id = ${subject}::text
      AND u.deleted_at IS NULL
    LIMIT 2`;

  return {
    async personOf(subject) {
      let rows = await timed(byUser(subject));
      if (rows.length === 0) rows = await timed(bySession(subject));
      // More than one person: refuse, never pick (the newest session could
      // be someone else who signed in on the same browser).
      if (rows.length > 1) {
        throw new PersonRefused(
          'This sign-in matches more than one account, so dForms will not guess which one it is. Contact support; do not retry.',
        );
      }
      const [row] = rows;
      if (!row) return null;
      if (!row.is_active || row.blocked) {
        throw new PersonRefused('This account is inactive or blocked. Contact support; do not retry.');
      }
      return { id: row.id, email: row.email } satisfies Person;
    },
    close: () => sql.end({ timeout: 5 }),
  };
}
