/**
 * API keys (public API v1, migration 0024). A key belongs to one member in one
 * workspace and acts as that person: their role is read on every request and
 * the key stops working the moment they are no longer an active member there.
 *
 * Only the SHA-256 of a key is stored (`key_hash`), with its first characters
 * (`prefix`, unique) and its last four (`last4`, what the Developers page
 * shows). The key in clear is the caller's to keep: this layer never sees it.
 * Hashing and the key format live with the API, which is the only writer.
 *
 * Revoking is a soft delete (`revoked_at_ms`): a revoked key never lists and
 * never authenticates, but the row stays for the record.
 */
import { randomUUID } from "node:crypto";
import { sql, type Db } from "./client";
import type { AccountRole } from "./members";

/** How many ACTIVE keys one member may hold in one workspace. */
export const API_KEY_LIMIT_PER_MEMBER = 10;

/** Who created a key, as the list names them. `name`/`email` are null once the member is gone. */
export interface ApiKeyCreator {
  memberId: string;
  name: string | null;
  email: string | null;
}

/** An active key as the Developers page lists it. Never carries the hash. */
export interface ApiKeyView {
  id: string;
  name: string;
  last4: string;
  createdAt: number;
  lastUsedAt: number | null;
  createdBy: ApiKeyCreator;
}

/** One active key, scoped to its workspace, for the revoke path's ownership check. */
export interface ApiKeyRecord {
  id: string;
  accountId: string;
  memberId: string | null;
  name: string;
  last4: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/**
 * What an incoming key resolves to: the key, and the member it acts as with
 * their CURRENT role and status. The status is returned rather than filtered so
 * the caller decides (and says) why a key no longer works.
 */
export interface ApiKeyPrincipalRow {
  keyId: string;
  accountId: string;
  memberId: string;
  role: AccountRole;
  memberStatus: string;
  lastUsedAt: number | null;
}

export type InsertApiKeyResult =
  | { ok: true; value: ApiKeyRecord }
  | { ok: false; reason: "KEY_LIMIT" };

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

function toRecord(r: Record<string, unknown>): ApiKeyRecord {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    memberId: r.member_id == null ? null : String(r.member_id),
    name: String(r.name),
    last4: String(r.last4),
    createdAt: num(r.created_at),
    lastUsedAt: numOrNull(r.last_used_at_ms),
  };
}

/**
 * Store a new key for `memberId` in `accountId`, unless that member already
 * holds `API_KEY_LIMIT_PER_MEMBER` active keys there.
 *
 * The count and the insert are ONE statement (`INSERT ... SELECT ... WHERE
 * count < limit`). On SQLite that alone serializes two creates racing at nine.
 * On Postgres it does not: under READ COMMITTED both statements can count nine
 * and both insert. So there the statement runs in a transaction that first
 * takes an advisory lock on this member in this workspace; the second create
 * waits, then counts again with a fresh snapshot and sees the tenth.
 * Whether the row exists afterwards is the answer.
 */
export async function insertApiKey(
  db: Db,
  input: {
    accountId: string;
    memberId: string;
    name: string;
    keyHash: string;
    prefix: string;
    last4: string;
  },
  now: number = Date.now(),
  limit: number = API_KEY_LIMIT_PER_MEMBER,
): Promise<InsertApiKeyResult> {
  const id = randomUUID();
  const insert = sql`INSERT INTO api_key (id, account_id, member_id, name, prefix, last4, key_hash, created_at)
        SELECT ${id}, ${input.accountId}, ${input.memberId}, ${input.name}, ${input.prefix},
               ${input.last4}, ${input.keyHash}, ${now}
        WHERE (SELECT COUNT(*) FROM api_key
               WHERE account_id = ${input.accountId} AND member_id = ${input.memberId}
                 AND revoked_at_ms IS NULL) < ${limit}`;
  if (db.dialect === "postgres" && db.pg) {
    const lockKey = `api_key:${input.accountId}:${input.memberId}`;
    await db.pg.drizzle.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      await tx.execute(insert);
    });
  } else {
    await db.run(insert);
  }
  const row = await getApiKeyById(db, input.accountId, id);
  return row ? { ok: true, value: row } : { ok: false, reason: "KEY_LIMIT" };
}

/** One ACTIVE key of this workspace; null when unknown, revoked or another workspace's. */
export async function getApiKeyById(
  db: Db,
  accountId: string,
  id: string,
): Promise<ApiKeyRecord | null> {
  const r = await db.get<Record<string, unknown>>(
    sql`SELECT id, account_id, member_id, name, last4, created_at, last_used_at_ms
        FROM api_key
        WHERE account_id = ${accountId} AND id = ${id} AND revoked_at_ms IS NULL
        LIMIT 1`,
  );
  return r ? toRecord(r) : null;
}

/**
 * The ACTIVE keys of a workspace, newest first, with who created each.
 * `memberId` narrows to that member's own keys (what a plain member sees);
 * omitted, every active key of the workspace (owner and admin).
 */
export async function listApiKeys(
  db: Db,
  accountId: string,
  memberId?: string,
): Promise<ApiKeyView[]> {
  const mine = memberId === undefined ? sql`` : sql` AND k.member_id = ${memberId}`;
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT k.id, k.name, k.last4, k.created_at, k.last_used_at_ms, k.member_id,
               m.display_name, m.email
        FROM api_key k
        LEFT JOIN member m ON m.id = k.member_id AND m.account_id = k.account_id
        WHERE k.account_id = ${accountId} AND k.revoked_at_ms IS NULL${mine}
        ORDER BY k.created_at DESC, k.id ASC`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    last4: String(r.last4),
    createdAt: num(r.created_at),
    lastUsedAt: numOrNull(r.last_used_at_ms),
    createdBy: {
      memberId: r.member_id == null ? "" : String(r.member_id),
      name: r.display_name == null ? null : String(r.display_name),
      email: r.email == null ? null : String(r.email),
    },
  }));
}

/** Revoke one active key of this workspace. False when there was nothing to revoke. */
export async function revokeApiKey(
  db: Db,
  accountId: string,
  id: string,
  now: number = Date.now(),
): Promise<boolean> {
  const existing = await getApiKeyById(db, accountId, id);
  if (!existing) return false;
  await db.run(
    sql`UPDATE api_key SET revoked_at_ms = ${now}
        WHERE account_id = ${accountId} AND id = ${id} AND revoked_at_ms IS NULL`,
  );
  return true;
}

/**
 * Resolve an incoming key by its hash: the active key and the member it acts
 * as, in the key's own workspace. Null when the hash is unknown, the key is
 * revoked, it predates `member_id`, or its member is no longer in that
 * workspace at all.
 */
export async function findApiKeyPrincipal(
  db: Db,
  keyHash: string,
): Promise<ApiKeyPrincipalRow | null> {
  const r = await db.get<Record<string, unknown>>(
    sql`SELECT k.id, k.account_id, k.member_id, k.last_used_at_ms, m.role, m.status
        FROM api_key k
        JOIN member m ON m.id = k.member_id AND m.account_id = k.account_id
        WHERE k.key_hash = ${keyHash} AND k.revoked_at_ms IS NULL
        LIMIT 1`,
  );
  if (!r) return null;
  return {
    keyId: String(r.id),
    accountId: String(r.account_id),
    memberId: String(r.member_id),
    role: ((r.role as AccountRole | null) ?? "member") as AccountRole,
    memberStatus: String(r.status ?? "active"),
    lastUsedAt: numOrNull(r.last_used_at_ms),
  };
}

/**
 * Stamp a key's last use, at most once per `throttleMs` (a minute by default).
 * The throttle lives in the WHERE, so it holds across pods: a busy key writes
 * about once a minute, not once per call.
 */
export async function touchApiKeyLastUsed(
  db: Db,
  keyId: string,
  now: number = Date.now(),
  throttleMs: number = 60_000,
): Promise<void> {
  await db.run(
    sql`UPDATE api_key SET last_used_at_ms = ${now}
        WHERE id = ${keyId}
          AND (last_used_at_ms IS NULL OR last_used_at_ms <= ${now - throttleMs})`,
  );
}
