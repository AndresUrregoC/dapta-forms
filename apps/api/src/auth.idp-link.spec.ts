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
/** The person's upstream user id: what a real login binds every member of theirs to. */
const PERSON = 'iam_alex';
const SUBJECT = 'user_01HSPECSUBJECT0000000000';
const DAY = 86_400_000;

let db: Db;
let homeAccountId: string;
let homeMemberId: string;
/** What the next session token vouches for, on top of who the dev stub resolves. */
let vouch: Pick<ResolvedHost, 'idpSubject' | 'authenticatedAt' | 'lookUpIdpSubject' | 'confirmsMemberships' | 'staff'>;
/** The person the session token names (undefined: a provider that names nobody). */
let person: string | undefined;
let audit: string[];
let auth: AuthService;

const as = (workspace?: string): ReqLike => ({
  headers: { 'x-quill-email': EMAIL, ...(workspace ? { [WORKSPACE_HEADER]: workspace } : {}) },
});

const linkOf = async (memberId: string) =>
  db.get<{ idp_subject: string | null; login_seen_at: number | null }>(sql`SELECT idp_subject, login_seen_at FROM member WHERE id = ${memberId}`);

async function otherWorkspace(
  name: string,
  grant: 'staff' | null = null,
  externalId: string | null = PERSON,
): Promise<{ accountId: string; memberId: string }> {
  await insertAccountWithShortCode(db, { name, externalId: `ext:${name}` });
  const accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = ${`ext:${name}`}`))!.id;
  const memberId = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, external_id, email, handle, role, status, access_grant, created_at)
        VALUES (${memberId}, ${accountId}, ${externalId}, ${EMAIL}, ${`h-${name}`}, 'admin', 'active', ${grant}, ${Date.now()})`,
  );
  return { accountId, memberId };
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  homeAccountId = (await getAccountByCode(db, 'acme'))!.id;
  homeMemberId = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE account_id = ${homeAccountId} AND email = ${EMAIL}`))!.id;
  // The dev stub's seed binds nobody; a real login binds the member to the person.
  await db.run(sql`UPDATE member SET external_id = ${PERSON} WHERE id = ${homeMemberId}`);
  const local = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  vouch = { idpSubject: SUBJECT, authenticatedAt: Date.now() - 1_000 };
  person = PERSON;
  const provider: AuthProvider = {
    name: 'spec',
    resolveHost: async (req) => ({ ...(await local.resolveHost(req)), personId: person, ...vouch }),
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

  it("never records or stamps anything on someone else's row the switch reached by a shared email", async () => {
    const theirs = await otherWorkspace('Theirs', null, 'iam_someone_else');
    await auth.resolveHost(as(theirs.accountId));
    expect(await linkOf(theirs.memberId)).toEqual({ idp_subject: null, login_seen_at: null });
    expect(audit.every((l) => !l.includes(theirs.memberId))).toBe(true);
  });

  it('writes nothing on a home member bound to someone else than the person the token names, or when it names nobody', async () => {
    person = 'iam_someone_else';
    await auth.resolveHost(as());
    expect(await linkOf(homeMemberId)).toEqual({ idp_subject: null, login_seen_at: null });
    person = undefined;
    await auth.resolveHost(as());
    expect(await linkOf(homeMemberId)).toEqual({ idp_subject: null, login_seen_at: null });
  });

  it('never records anything on a row no login bound to a person, reached by email on the web', async () => {
    const unbound = await otherWorkspace('Unbound', null, null);
    await auth.resolveHost(as(unbound.accountId));
    expect(await linkOf(unbound.memberId)).toEqual({ idp_subject: null, login_seen_at: null });
  });

  it('stamps the staff access grants of a person proven staff on the request, never records a subject on them, and leaves them alone otherwise', async () => {
    const grant = await otherWorkspace('Customer', 'staff');
    const asStaff = (staff: boolean) =>
      new AuthService(db, {
        name: 'spec-staff',
        resolveHost: async () => ({ accountId: homeAccountId, memberId: homeMemberId, staff, personId: PERSON, ...vouch }),
      });
    // Not staff on this request: the grant is never vouched for.
    await asStaff(false).resolveHost({ headers: {} });
    expect(await linkOf(grant.memberId)).toEqual({ idp_subject: null, login_seen_at: null });
    // Proven staff: the grant is stamped with the token's issue time, and carries no subject.
    await asStaff(true).resolveHost({ headers: {} });
    expect(await linkOf(grant.memberId)).toEqual({ idp_subject: null, login_seen_at: vouch.authenticatedAt });
    // Entering the grant's workspace itself records nothing on it either.
    const inside = new AuthService(db, {
      name: 'spec-staff-inside',
      resolveHost: async () => ({ accountId: grant.accountId, memberId: grant.memberId, staff: true, personId: PERSON, ...vouch }),
    });
    await inside.resolveHost({ headers: {} });
    expect((await linkOf(grant.memberId))?.idp_subject).toBeNull();
  });

  it('vouches for every active membership of the person when the identity service just confirmed them, and only the acting one otherwise', async () => {
    const beta = await otherWorkspace('Beta');
    const gamma = await otherWorkspace('Gamma');
    await db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${gamma.memberId}`);
    const someoneElse = await otherWorkspace('Theirs', null, 'iam_someone_else');
    await auth.resolveHost(as());
    expect((await linkOf(beta.memberId))?.login_seen_at).toBeNull();
    vouch = { ...vouch, confirmsMemberships: true };
    await auth.resolveHost(as());
    expect((await linkOf(beta.memberId))?.login_seen_at).toBe(vouch.authenticatedAt);
    // Never a disabled member, nor someone else's row.
    expect((await linkOf(gamma.memberId))?.login_seen_at).toBeNull();
    expect((await linkOf(someoneElse.memberId))?.login_seen_at).toBeNull();
  });

  it('links an older session through the identity service only while the member has no link, and records nothing when it answers none', async () => {
    let asked = 0;
    let answer: string | null = null;
    vouch = { authenticatedAt: Date.now() - 1_000, lookUpIdpSubject: async () => ((asked += 1), answer) };
    await auth.resolveHost(as());
    expect(asked).toBe(1);
    expect((await linkOf(homeMemberId))?.idp_subject).toBeNull();
    answer = SUBJECT;
    await auth.resolveHost(as());
    expect(asked).toBe(2);
    expect((await linkOf(homeMemberId))?.idp_subject).toBe(SUBJECT);
    // Linked now: never asked again.
    await auth.resolveHost(as());
    expect(asked).toBe(2);
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
