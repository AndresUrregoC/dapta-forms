/**
 * What a verified web request records for MCP sign-ins (`AuthService`): the
 * person's user id at the external authorization server on the member the
 * request acts as (`member.idp_subject`), and when the identity service
 * vouched for that member (`member.login_seen_at`, the token's issue time).
 * The real `AuthService` on in-memory SQLite, behind a provider that says
 * what a session token would.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, getAccountByCode, insertAccountWithShortCode, migrate, seed, sql, type Db } from '@quill/db';
import { AuthService, LOGIN_SEEN_REFRESH_MS, WORKSPACE_HEADER, loginSeenRefreshMs } from './auth.service';
import { LocalAuthProvider, type AuthProvider, type ReqLike, type ResolvedHost } from './auth.provider';

const EMAIL = 'alex@example.com';
const SUBJECT = 'user_01HSPECSUBJECT0000000000';
const DAY = 86_400_000;

let db: Db;
let homeAccountId: string;
let homeMemberId: string;
/** What the next session token vouches for, on top of who the dev stub resolves. */
let vouch: Pick<ResolvedHost, 'idpSubject' | 'authenticatedAt'>;
let audit: string[];
let auth: AuthService;

const as = (workspace?: string): ReqLike => ({
  headers: { 'x-quill-email': EMAIL, ...(workspace ? { [WORKSPACE_HEADER]: workspace } : {}) },
});

const linkOf = async (memberId: string) =>
  db.get<{ idp_subject: string | null; login_seen_at: number | null }>(sql`SELECT idp_subject, login_seen_at FROM member WHERE id = ${memberId}`);

async function otherWorkspace(name: string, grant: 'staff' | null = null): Promise<{ accountId: string; memberId: string }> {
  await insertAccountWithShortCode(db, { name, externalId: `ext:${name}` });
  const accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = ${`ext:${name}`}`))!.id;
  const memberId = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, email, handle, role, status, access_grant, created_at)
        VALUES (${memberId}, ${accountId}, ${EMAIL}, ${`h-${name}`}, 'admin', 'active', ${grant}, ${Date.now()})`,
  );
  return { accountId, memberId };
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  homeAccountId = (await getAccountByCode(db, 'acme'))!.id;
  homeMemberId = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE account_id = ${homeAccountId} AND email = ${EMAIL}`))!.id;
  const local = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  vouch = { idpSubject: SUBJECT, authenticatedAt: Date.now() - 1_000 };
  const provider: AuthProvider = {
    name: 'spec',
    resolveHost: async (req) => ({ ...(await local.resolveHost(req)), ...vouch }),
  };
  auth = new AuthService(db, provider);
  audit = [];
  auth.auditSink = (line) => audit.push(line);
});

afterEach(async () => {
  await db.close();
});

describe('a verified web request', () => {
  it('records the subject on the member it acts as, stamped with the token issue time, and logs it once', async () => {
    await auth.resolveHost(as());
    expect(await linkOf(homeMemberId)).toEqual({ idp_subject: SUBJECT, login_seen_at: vouch.authenticatedAt });
    expect(audit.map((l) => JSON.parse(l) as unknown)).toEqual([
      { msg: 'auth.idp_subject_recorded', accountId: homeAccountId, memberId: homeMemberId, takenFrom: [] },
    ]);
    // The same token again: nothing to write.
    await auth.resolveHost(as());
    expect(audit).toHaveLength(1);
  });

  it('records it on the workspace a request switches to as well', async () => {
    const beta = await otherWorkspace('Beta');
    await auth.resolveHost(as(beta.accountId));
    expect((await linkOf(beta.memberId))?.idp_subject).toBe(SUBJECT);
  });

  it('never records anything on a row held through a staff access grant', async () => {
    const grant = await otherWorkspace('Customer', 'staff');
    const staff = new AuthService(db, {
      name: 'spec-staff',
      resolveHost: async () => ({ accountId: grant.accountId, memberId: grant.memberId, staff: true, ...vouch }),
    });
    await staff.resolveHost({ headers: {} });
    expect(await linkOf(grant.memberId)).toEqual({ idp_subject: null, login_seen_at: null });
  });

  it('renews the stamp only once it is a refresh step old, and never moves it backwards', async () => {
    const t0 = Date.now() - 3 * DAY;
    vouch = { idpSubject: SUBJECT, authenticatedAt: t0 };
    await auth.resolveHost(as());
    vouch = { idpSubject: SUBJECT, authenticatedAt: t0 + DAY - 1 };
    await auth.resolveHost(as());
    expect((await linkOf(homeMemberId))?.login_seen_at).toBe(t0);
    vouch = { idpSubject: SUBJECT, authenticatedAt: t0 + DAY + 1 };
    await auth.resolveHost(as());
    expect((await linkOf(homeMemberId))?.login_seen_at).toBe(t0 + DAY + 1);
    vouch = { idpSubject: SUBJECT, authenticatedAt: t0 };
    await auth.resolveHost(as());
    expect((await linkOf(homeMemberId))?.login_seen_at).toBe(t0 + DAY + 1);
  });

  it('caps a token issue time in the future at now', async () => {
    vouch = { idpSubject: SUBJECT, authenticatedAt: Date.now() + 10 * DAY };
    await auth.resolveHost(as());
    expect(Number((await linkOf(homeMemberId))?.login_seen_at)).toBeLessThanOrEqual(Date.now());
  });

  it('writes nothing for a provider that vouches for nothing (the dev stub), and only the subject for a token without an issue time', async () => {
    vouch = {};
    await auth.resolveHost(as());
    expect(await linkOf(homeMemberId)).toEqual({ idp_subject: null, login_seen_at: null });
    vouch = { idpSubject: SUBJECT, authenticatedAt: null };
    await auth.resolveHost(as());
    expect(await linkOf(homeMemberId)).toEqual({ idp_subject: SUBJECT, login_seen_at: null });
  });
});

describe('loginSeenRefreshMs', () => {
  it('is a day, or a quarter of a shorter window', () => {
    expect(loginSeenRefreshMs(30)).toBe(LOGIN_SEEN_REFRESH_MS);
    expect(loginSeenRefreshMs(1)).toBe(DAY / 4);
  });
});
