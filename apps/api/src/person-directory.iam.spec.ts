/**
 * The identity-service person directory against a real Postgres: a minimal
 * `users` + `sessions` schema created here, in a schema of its own, and the
 * adapter reading it the way it reads the identity service's database.
 *
 * Runs when DATABASE_URL is a Postgres URL (the Postgres CI job, or
 * `DATABASE_URL=postgres://quill:quill@localhost:5432/quill`); skipped on the
 * SQLite run, which has no Postgres to read.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import postgres from 'postgres';
import { isPostgresUrl } from '@quill/config/env';
import { PersonRefused } from './person-directory';
import { createIamPersonDirectory, type IamDirectoryConfig, type IamPersonDirectory } from './person-directory.iam';

const url = process.env.DATABASE_URL ?? '';
const onPostgres = isPostgresUrl(url);

describe.skipIf(!onPostgres)('the identity-service person directory, on Postgres', () => {
  const schema = `iam_spec_${randomUUID().slice(0, 8)}`;
  let admin: postgres.Sql;
  let config: IamDirectoryConfig;
  const open: IamPersonDirectory[] = [];

  function directory(over: Partial<IamDirectoryConfig> = {}, opts?: Parameters<typeof createIamPersonDirectory>[1]) {
    const d = createIamPersonDirectory({ ...config, ...over }, opts);
    open.push(d);
    return d;
  }

  async function user(fields: { workosUserId?: string | null; email?: string; isActive?: boolean; blocked?: boolean; deleted?: boolean } = {}) {
    const id = randomUUID();
    const email = fields.email ?? `${id.slice(0, 8)}@example.com`;
    await admin.unsafe(
      `INSERT INTO ${schema}.users (id, email, workos_user_id, is_active, blocked_at, deleted_at)
       VALUES ($1, $2, $3, $4, ${fields.blocked ? 'now()' : 'NULL'}, ${fields.deleted ? 'now()' : 'NULL'})`,
      [id, email, fields.workosUserId ?? null, fields.isActive ?? true],
    );
    return { id, email };
  }

  async function session(userId: string, workosUserId: string) {
    await admin.unsafe(`INSERT INTO ${schema}.sessions (id, user_id, workos_user_id) VALUES ($1, $2, $3)`, [
      randomUUID(),
      userId,
      workosUserId,
    ]);
  }

  const subject = () => `user_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  beforeAll(async () => {
    admin = postgres(url, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.unsafe(`
      CREATE TABLE ${schema}.users (
        id uuid PRIMARY KEY,
        email text NOT NULL,
        workos_user_id text,
        is_active boolean NOT NULL DEFAULT true,
        blocked_at timestamptz,
        deleted_at timestamptz
      );
      CREATE TABLE ${schema}.sessions (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES ${schema}.users (id),
        workos_user_id text
      );
    `);
    const u = new URL(url);
    config = {
      host: u.hostname,
      port: Number(u.port || 5432),
      database: decodeURIComponent(u.pathname.slice(1)),
      schema,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      tls: false,
    };
  });

  afterAll(async () => {
    await Promise.all(open.map((d) => d.close()));
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  it('finds a person by the user row that carries the subject', async () => {
    const sub = subject();
    const u = await user({ workosUserId: sub });
    expect(await directory().personOf(sub)).toEqual({ id: u.id, email: u.email });
  });

  it('falls back to the sessions when no user row carries the subject', async () => {
    const sub = subject();
    const u = await user({ workosUserId: null });
    await session(u.id, sub);
    await session(u.id, sub);
    expect(await directory().personOf(sub)).toEqual({ id: u.id, email: u.email });
  });

  it('prefers the user row over a session that names someone else', async () => {
    const sub = subject();
    const owner = await user({ workosUserId: sub });
    const other = await user();
    await session(other.id, sub);
    expect(await directory().personOf(sub)).toEqual({ id: owner.id, email: owner.email });
  });

  it('knows nobody by an unknown subject, or by a deleted user in either table', async () => {
    const d = directory();
    expect(await d.personOf(subject())).toBeNull();
    const gone = subject();
    await user({ workosUserId: gone, deleted: true });
    expect(await d.personOf(gone)).toBeNull();
    const goneBySession = subject();
    const deleted = await user({ deleted: true });
    await session(deleted.id, goneBySession);
    expect(await d.personOf(goneBySession)).toBeNull();
  });

  it('refuses, never picks, when the sessions link the subject to two people', async () => {
    const sub = subject();
    const a = await user();
    const b = await user();
    await session(a.id, sub);
    await session(b.id, sub);
    await expect(directory().personOf(sub)).rejects.toThrow(PersonRefused);
    await expect(directory().personOf(sub)).rejects.toThrow(/more than one account/);
  });

  it('refuses when two user rows carry the subject', async () => {
    const sub = subject();
    await user({ workosUserId: sub });
    await user({ workosUserId: sub });
    await expect(directory().personOf(sub)).rejects.toThrow(PersonRefused);
  });

  it('refuses an inactive or blocked person, found either way', async () => {
    const d = directory();
    const inactive = subject();
    await user({ workosUserId: inactive, isActive: false });
    await expect(d.personOf(inactive)).rejects.toThrow(/inactive or blocked/);
    const blocked = subject();
    const b = await user({ blocked: true });
    await session(b.id, blocked);
    await expect(d.personOf(blocked)).rejects.toThrow(PersonRefused);
  });

  it('throws, never answers nobody, when the database cannot be reached', async () => {
    const error = await directory({ host: '127.0.0.1', port: await closedPort() }).personOf(subject()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PersonRefused);
  });

  it('never falls back to plain text when TLS is on and the server does not offer it', async () => {
    // The spec database speaks no TLS, so a directory that insists on it cannot read it.
    const sub = subject();
    await user({ workosUserId: sub });
    await expect(directory({ tls: true }).personOf(sub)).rejects.toThrow();
  });

  it('gives up on a query that does not answer in time', async () => {
    const slow = `${schema}_slow`;
    await admin.unsafe(`CREATE SCHEMA ${slow}`);
    await admin.unsafe(`CREATE VIEW ${slow}.users AS SELECT u.* FROM ${schema}.users u WHERE (SELECT pg_sleep(3)::text) IS NOT NULL`);
    try {
      const started = Date.now();
      await expect(directory({ schema: slow }, { queryTimeoutMs: 200 }).personOf(subject())).rejects.toThrow(/did not answer/);
      expect(Date.now() - started).toBeLessThan(2500);
    } finally {
      await admin.unsafe(`DROP SCHEMA ${slow} CASCADE`);
    }
  });

  it('keeps its pool small however many lookups arrive at once', async () => {
    await Promise.all(open.splice(0).map((d) => d.close()));
    const d = directory();
    const sub = subject();
    await user({ workosUserId: sub });
    await Promise.all(Array.from({ length: 24 }, () => d.personOf(sub)));
    const [row] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'dforms-person-directory'`;
    expect(row!.n).toBeGreaterThan(0);
    expect(row!.n).toBeLessThanOrEqual(4);
  });
});

/** A loopback port nothing listens on. */
async function closedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}
