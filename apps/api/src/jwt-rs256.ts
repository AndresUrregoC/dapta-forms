/**
 * RS256 access-token verification against an issuer's published keys (JWKS),
 * for the MCP OAuth adapters. Hand-rolled on `node:crypto`, like the HS256
 * verifier in `jwt.ts` (clone-and-run stays dependency-light), and written for
 * an auth path:
 *   - the algorithm is HARD-PINNED to RS256: `none`, HS* and every other
 *     `alg` are refused before a key is looked up (no alg confusion);
 *   - the key is chosen by the header's `kid` among the issuer's RSA signing
 *     keys only; a token without a `kid` is refused;
 *   - `iss` and `aud` must match exactly (`aud` may be a list containing it);
 *   - `sub` and `exp` are REQUIRED: a token without an expiry would be good
 *     forever, so it is refused rather than trusted;
 *   - any failure, including the issuer being unreachable, is `null`, never a
 *     throw, so a bad token can only ever become a 401.
 */
import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';

/** The claims of a verified token that callers read. */
export interface VerifiedClaims {
  sub: string;
  exp: number;
  [claim: string]: unknown;
}

export interface Rs256Options {
  issuer: string;
  audience: string;
  /** The public key for a key id, or null when the issuer publishes none by that id. */
  keyFor(kid: string): Promise<KeyObject | null>;
  /** Epoch seconds; injectable for tests. */
  now?: () => number;
  /** Clock skew tolerated on `exp` and `nbf`, in seconds. */
  leewaySec?: number;
}

/** No real access token is this long; refusing earlier keeps parsing bounded. */
const MAX_TOKEN_LENGTH = 16_384;

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The token's claims when every rule above holds, else null. */
export async function verifyRs256(token: string, options: Rs256Options): Promise<VerifiedClaims | null> {
  try {
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = decodeJson(headerPart);
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid === '') return null;

    const key = await options.keyFor(header.kid);
    if (!key) return null;
    const signed = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${headerPart}.${payloadPart}`),
      key,
      Buffer.from(signaturePart, 'base64url'),
    );
    if (!signed) return null;

    const claims = decodeJson(payloadPart);
    if (!claims) return null;
    const now = options.now?.() ?? Math.floor(Date.now() / 1000);
    const leeway = options.leewaySec ?? 30;
    if (claims.iss !== options.issuer) return null;
    const aud = claims.aud;
    if (!(aud === options.audience || (Array.isArray(aud) && aud.includes(options.audience)))) return null;
    if (typeof claims.sub !== 'string' || claims.sub === '') return null;
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp + leeway <= now) return null;
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf - leeway > now)) return null;
    return claims as VerifiedClaims;
  } catch {
    return null;
  }
}

export interface RemoteJwksOptions {
  /** How long a fetched key set is trusted before it is fetched again. */
  maxAgeMs?: number;
  /** An unknown `kid` refetches the set at most once per this long, so junk tokens cannot hammer the issuer. */
  refetchCooldownMs?: number;
  /** A fetch that takes longer is abandoned (the token is refused). */
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * An issuer's key set, fetched over HTTP and cached. A `kid` missing from the
 * cache refetches once (the issuer rotated a key in), within the cooldown.
 */
export class RemoteJwks {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = -Infinity;
  /** When a fetch last started, so an issuer that is down is retried at most once a cooldown, not per request. */
  private attemptedAt = -Infinity;
  private lastMissRefetch = -Infinity;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly url: string,
    private readonly options: RemoteJwksOptions = {},
  ) {}

  async keyFor(kid: string): Promise<KeyObject | null> {
    const now = this.now();
    const cooldown = this.options.refetchCooldownMs ?? 30_000;
    const stale = now - this.fetchedAt > (this.options.maxAgeMs ?? 10 * 60_000);
    if (stale && now - this.attemptedAt >= Math.min(cooldown, 5_000)) await this.refresh();
    const cached = this.keys.get(kid);
    if (cached) return cached;
    if (now - this.lastMissRefetch < cooldown) return null;
    this.lastMissRefetch = now;
    await this.refresh();
    return this.keys.get(kid) ?? null;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private refresh(): Promise<void> {
    this.inFlight ??= this.load().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async load(): Promise<void> {
    this.attemptedAt = this.now();
    try {
      const res = await (this.options.fetch ?? fetch)(this.url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { keys?: unknown };
      if (!Array.isArray(body.keys)) return;
      const keys = new Map<string, KeyObject>();
      for (const jwk of body.keys as Array<Record<string, unknown>>) {
        if (!jwk || jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
        if (jwk.use !== undefined && jwk.use !== 'sig') continue;
        if (jwk.alg !== undefined && jwk.alg !== 'RS256') continue;
        try {
          keys.set(jwk.kid, createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e } as never, format: 'jwk' }));
        } catch {
          /* a malformed key is skipped, never fatal */
        }
      }
      this.keys = keys;
      this.fetchedAt = this.now();
    } catch {
      /* unreachable or not JSON: keep what was cached; unknown keys stay unknown */
    }
  }
}
