import { AsyncLocalStorage } from 'node:async_hooks';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The old-host hop for the dashboard, the wizard and the session refresh.
 *
 * Requests use the address the standalone server really listens on; the
 * public host only exists in the headers, as behind a proxy.
 */

const state = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT:${url}`);
    }
  }
  return {
    Redirect,
    /** The request being served: what `cookies()` and `headers()` answer from. */
    current: { jar: new Map<string, string>(), headers: new Headers(), writes: [] as string[] },
  };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = state.current.jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      state.current.writes.push(name);
      state.current.jar.set(name, value);
    },
    delete: (name: string) => {
      state.current.writes.push(name);
      state.current.jar.delete(name);
    },
  }),
  headers: async () => state.current.headers,
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new state.Redirect(url);
  },
}));

import { config, proxy } from './proxy';
import { GET as refreshRoute } from './app/api/auth/refresh/route';
import { GET as logoutRoute } from './app/api/auth/logout/route';
import { adminApi } from './lib/admin-api';
import { decodeSession, encodeSession, type Session } from './lib/auth-session';
import { SESSION_COOKIE } from './lib/session';

// Next's matcher helper reads its async storage at import time, which only a
// running Next server provides globally.
let doesMatch: (url: string) => boolean;
beforeAll(async () => {
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;
  const { unstable_doesMiddlewareMatch } = await import('next/experimental/testing/server');
  doesMatch = (url) => unstable_doesMiddlewareMatch({ config, url, nextConfig: {} });
});

const CANONICAL = 'https://app.example.com';
const OLD = 'forms.example.org';
const LISTEN = 'http://0.0.0.0:3000';

const at = (path: string, headers: Record<string, string>, method = 'GET') =>
  new NextRequest(`${LISTEN}${path}`, { method, headers });

const expectHop = (res: Response, path: string) => {
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe(`${CANONICAL}${path}`);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('set-cookie')).toBeNull();
};
const expectPass = (res: Response) => {
  expect(res.headers.get('location')).toBeNull();
  expect(res.headers.get('x-middleware-next')).toBe('1');
};

describe('proxy matcher', () => {
  const HOPPED = [
    '/admin',
    '/admin/forms/f1/submissions?view=all&page=2',
    '/admin/developers/keys',
    '/admin/forms/f1/submissions/export?ids=a,b',
    '/onboarding',
    '/onboarding?step=3',
    '/api/auth/refresh',
  ];
  const UNTOUCHED = [
    '/',
    '/login',
    '/login?signedout=1',
    '/acme/jane',
    '/acme/f/contact/opengraph-image',
    '/embed.js',
    '/file/tok_abc',
    '/api/public/forms/acme/contact',
    '/api/public/forms/acme/contact/submissions',
    '/_next/static/chunks/main.js',
    '/_next/image?url=%2Fforms_logo.svg&w=64&q=75',
    '/icon.svg',
    '/apple-icon.png',
    '/forms_logo.svg',
    '/onboarding/hubspot.svg',
    '/mcp/logos/claude.svg',
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/callback',
    '/api/workspace/reset',
    '/preview',
    '/administrator',
    '/onboardingx',
  ];

  it.each(HOPPED)('runs on %s', (url) => {
    expect(doesMatch(url)).toBe(true);
  });

  it.each(UNTOUCHED)('never runs on %s (it keeps serving on the old host)', (url) => {
    expect(doesMatch(url)).toBe(false);
  });

  // A public form page runs it only for the real-404 check below.
  it.each(['/acme/f/contact', '/acme/f/contact?embed=1', '/acme/jane/contact?embed=1&utm_source=x'])(
    'runs on the public form page %s',
    (url) => {
      expect(doesMatch(url)).toBe(true);
    },
  );
});

/**
 * A public form that does not exist answers a REAL 404 (the page itself cannot:
 * its loading boundary has streamed a 200 by the time it knows).
 */
describe('proxy on a public form page', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('PUBLIC_APP_URL', CANONICAL);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  const nav = { host: OLD, 'sec-fetch-mode': 'navigate', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' };

  it('a form the API does not know: 404, rewritten to the not-found screen', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
    const res = await proxy(at('/acme/f/gone?utm_source=x', nav));
    expect(res.status).toBe(404);
    expect(res.headers.get('x-middleware-rewrite')).toContain('/_form-not-found');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/v1\/public\/forms\/acme\/gone$/);
    // The visitor's chain, verbatim: the API rate-limits the visitor, not this server.
    expect((init as RequestInit).headers).toEqual({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
  });

  it('a live form is served as usual, and never hops to another host', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    expectPass(await proxy(at('/acme/f/live', nav)));
  });

  it.each([
    ['a 5xx', () => Promise.resolve(new Response('', { status: 503 }))],
    ['a rate limit', () => Promise.resolve(new Response('', { status: 429 }))],
    ['a network error or timeout', () => Promise.reject(new Error('aborted'))],
  ])('fails open on %s: the page renders as before', async (_label, answer) => {
    fetchMock.mockImplementation(answer);
    expectPass(await proxy(at('/acme/f/maybe', nav)));
  });

  it('checks nothing for the router, a prefetch, a fetch() or a POST', async () => {
    expectPass(await proxy(at('/acme/f/x', { ...nav, rsc: '1' })));
    expectPass(await proxy(at('/acme/f/x', { ...nav, 'next-router-prefetch': '1' })));
    expectPass(await proxy(at('/acme/f/x', { host: OLD, 'sec-fetch-mode': 'cors' })));
    expectPass(await proxy(at('/acme/f/x', nav, 'POST')));
    expectPass(await proxy(at('/admin/forms/f1', { host: CANONICAL.replace('https://', ''), 'sec-fetch-mode': 'navigate' })));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('proxy on a host other than PUBLIC_APP_URL', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('PUBLIC_APP_URL', CANONICAL);
  });

  it.each([
    '/admin',
    '/admin/forms/f1/submissions?view=all&page=2',
    '/admin/forms/f1/edit?step=s2&q=a+b&empty=&bare',
    '/onboarding?step=3',
    '/api/auth/refresh',
    '/api/auth/refresh?reason=x',
  ])('GET %s: 302 to the same path and query on PUBLIC_APP_URL, no cookie', async (path) => {
    expectHop(await proxy(at(path, { host: OLD, 'sec-fetch-mode': 'navigate' })), path);
  });

  it('hops a HEAD, and a request without fetch metadata (curl, an old client)', async () => {
    expectHop(await proxy(at('/admin/forms', { host: OLD }, 'HEAD')), '/admin/forms');
    expectHop(await proxy(at('/admin/forms', { host: OLD })), '/admin/forms');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'lets a %s through: a Server Action or form post from a tab opened before the move keeps working there',
    async (method) => {
      expectPass(await proxy(at('/admin/forms/f1/edit', { host: OLD, 'next-action': 'abc123' }, method)));
      expectPass(await proxy(at('/onboarding', { host: OLD }, method)));
    },
  );

  it.each(['cors', 'same-origin', 'no-cors'])(
    'lets a page fetch() through (Sec-Fetch-Mode: %s): it cannot follow a cross-origin redirect',
    async (mode) => {
      expectPass(await proxy(at('/admin/integrations/calendly/event-types', { host: OLD, 'sec-fetch-mode': mode })));
      expectPass(await proxy(at('/admin/forms/f1', { host: OLD, 'sec-fetch-mode': mode })));
      expectPass(await proxy(at('/onboarding', { host: OLD, 'sec-fetch-mode': mode })));
    },
  );

  it('hops the refresh for a fetch() too: it never runs its session logic on another host', async () => {
    expectHop(await proxy(at('/api/auth/refresh', { host: OLD, 'sec-fetch-mode': 'cors' })), '/api/auth/refresh');
  });

  it('reads X-Forwarded-Host before Host, and a forged one can only send its sender to PUBLIC_APP_URL', async () => {
    expectHop(await proxy(at('/admin', { 'x-forwarded-host': OLD, host: 'web:3000' })), '/admin');
    expectPass(await proxy(at('/admin', { 'x-forwarded-host': 'app.example.com', host: 'web:3000' })));
    const forged = await proxy(at('/admin', { 'x-forwarded-host': 'evil.example.net', host: 'app.example.com' }));
    expect(new URL(forged.headers.get('location')!).origin).toBe(CANONICAL);
  });

  it('does not loop on the dev server answering under another name for its own address', async () => {
    // `next dev` on localhost:3000 opened as 127.0.0.1:3000: Next would turn a
    // redirect to its own listen address into a relative Location.
    vi.stubEnv('PUBLIC_APP_URL', 'http://localhost:3000');

    expectPass(await proxy(new NextRequest('http://localhost:3000/admin', { headers: { host: '127.0.0.1:3000' } })));
  });
});

describe('proxy where nothing changes', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('PUBLIC_APP_URL', CANONICAL);
  });

  it('on the PUBLIC_APP_URL host, whatever the case or port', async () => {
    for (const host of ['app.example.com', 'APP.Example.com', 'app.example.com:443']) {
      expectPass(await proxy(at('/admin/forms', { host, 'sec-fetch-mode': 'navigate' })));
      expectPass(await proxy(at('/api/auth/refresh', { host, 'sec-fetch-mode': 'navigate' })));
    }
  });

  it('without PUBLIC_APP_URL (self-host dev), blank or unparseable', async () => {
    for (const value of ['', '   ', 'not a url']) {
      vi.stubEnv('PUBLIC_APP_URL', value);
      expectPass(await proxy(at('/admin/forms', { host: OLD })));
      expectPass(await proxy(at('/api/auth/refresh', { host: OLD })));
    }
  });

  it('when no host can be read', async () => {
    expectPass(await proxy(at('/admin', {})));
  });
});

/**
 * The domain-move rehearsal, end to end: a browser with one cookie jar per
 * host, the real proxy, refresh and logout routes, the real session code, and
 * the real admin API client's 401 handling. Only the network (API, identity
 * service) and Next's request scope are stand-ins.
 */
describe('an old-host admin link while signed in on PUBLIC_APP_URL', () => {
  const IAM = 'https://iam.example.com/iam';
  const LIVE = new Set(['canon-access', 'canon-access-2', 'old-access']);
  const canonicalSession: Session = {
    provider: 'workos',
    accessToken: 'canon-access',
    refreshToken: 'canon-refresh',
    sessionId: 'session_shared',
  };
  const fetchMock = vi.fn();
  const revokes: unknown[] = [];
  const jars = new Map<string, Map<string, string>>();
  const jarOf = (hostname: string) => {
    if (!jars.has(hostname)) jars.set(hostname, new Map());
    return jars.get(hostname)!;
  };
  const sessionOn = (hostname: string) => decodeSession(jarOf(hostname).get(SESSION_COOKIE));

  /** One request, served the way Next would: the proxy first when its matcher says so. */
  async function serve(url: URL, useProxy: boolean): Promise<Response> {
    const headers = { host: url.host, 'sec-fetch-mode': 'navigate' };
    state.current = { jar: jarOf(url.hostname), headers: new Headers(headers), writes: [] };
    const req = at(`${url.pathname}${url.search}`, headers);
    if (useProxy && doesMatch(`${url.pathname}${url.search}`)) {
      const res = await proxy(req);
      if (res.headers.get('location')) {
        expect(state.current.writes).toEqual([]);
        return res;
      }
    }
    if (url.pathname === '/api/auth/refresh') return refreshRoute(req);
    if (url.pathname === '/api/auth/logout') return logoutRoute(req);
    if (url.pathname === '/login') return new Response('sign-in page', { status: 200 });
    if (url.pathname.startsWith('/admin')) {
      // The admin render's auth gate. In the app its redirect rides a streamed
      // 200 (step 1 of the rehearsal); the browser follows it all the same.
      try {
        await adminApi.me();
        return new Response('dashboard', { status: 200 });
      } catch (e) {
        if (e instanceof state.Redirect) return new Response(null, { status: 307, headers: { location: e.url } });
        throw e;
      }
    }
    throw new Error(`no route for ${url.href}`);
  }

  /** Follows redirects like a browser, resolving relative ones against the current URL. */
  async function open(start: string, { useProxy = true } = {}) {
    const trail: string[] = [];
    let url = new URL(start);
    for (let i = 0; i < 10; i++) {
      trail.push(url.href);
      const res = await serve(url, useProxy);
      const location = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !location) return { trail, res };
      url = new URL(location, url);
    }
    throw new Error(`redirect loop: ${trail.join(' -> ')}`);
  }

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('PUBLIC_APP_URL', CANONICAL);
    vi.stubEnv('AUTH_PROVIDER', 'workos');
    vi.stubEnv('IAM_BASE_URL', IAM);
    vi.stubEnv('WEB_SESSION_SECRET', 'test-secret-test-secret-test-secret');
    vi.stubGlobal('fetch', fetchMock);
    revokes.length = 0;
    jars.clear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/v1/me')) {
        const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? '';
        return LIVE.has(auth.replace(/^Bearer /, '')) ? json(200, { email: 'owner@example.com' }) : json(401, {});
      }
      if (url === `${IAM}/auth/refresh`) {
        const { refresh_token } = JSON.parse(String(init?.body)) as { refresh_token: string };
        return refresh_token === 'canon-refresh'
          ? json(200, { access_token: 'canon-access-2', refresh_token: 'canon-refresh-2' })
          : json(401, {});
      }
      if (url === `${IAM}/auth/logout?redirect=false`) {
        revokes.push(JSON.parse(String(init?.body)));
        return json(200, {});
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    // Signed in on the canonical host only: cookies are host-only.
    jarOf('app.example.com').set(SESSION_COOKIE, encodeSession(canonicalSession));
  });

  const LINK = `https://${OLD}/admin/forms/f1/submissions?view=all`;

  it('without the hop, reproduces the rehearsal: the old link ends on the canonical logout', async () => {
    const { trail } = await open(LINK, { useProxy: false });

    expect(trail).toEqual([
      LINK,
      `https://${OLD}/api/auth/refresh`,
      `${CANONICAL}/api/auth/logout?reason=expired`,
      `${CANONICAL}/login?signedout=1`,
    ]);
    expect(sessionOn('app.example.com')).toBeNull();
    expect(revokes).toEqual([{ workos_session_id: 'session_shared', session_id: 'session_shared' }]);
  });

  it('with the hop: the old link opens on PUBLIC_APP_URL, signed in, and nothing is revoked', async () => {
    const { trail, res } = await open(LINK);

    expect(trail).toEqual([LINK, `${CANONICAL}/admin/forms/f1/submissions?view=all`]);
    expect(await res.text()).toBe('dashboard');
    expect(trail.some((u) => u.includes('/api/auth/logout'))).toBe(false);
    expect(sessionOn('app.example.com')).toEqual(canonicalSession);
    expect(revokes).toEqual([]);
  });

  it('a refresh reached on the old host runs where the session lives, and returns to the dashboard', async () => {
    // What a render already under way on the old host would do on a 401.
    const { trail, res } = await open(`https://${OLD}/api/auth/refresh`);

    expect(trail).toEqual([`https://${OLD}/api/auth/refresh`, `${CANONICAL}/api/auth/refresh`, `${CANONICAL}/admin`]);
    expect(await res.text()).toBe('dashboard');
    expect(sessionOn('app.example.com')).toMatchObject({ accessToken: 'canon-access-2', refreshToken: 'canon-refresh-2' });
    expect(jarOf(OLD).size).toBe(0);
    expect(revokes).toEqual([]);
  });

  it('a sign-out on the old host clears only that host, stays there, and revokes nothing', async () => {
    // A cookie left from before the move, on the same upstream session.
    jarOf(OLD).set(SESSION_COOKIE, encodeSession({ ...canonicalSession, accessToken: 'old-access' }));

    const { trail } = await open(`https://${OLD}/api/auth/logout`);

    expect(trail).toEqual([`https://${OLD}/api/auth/logout`, `https://${OLD}/login?signedout=1`]);
    expect(sessionOn(OLD)).toBeNull();
    expect(sessionOn('app.example.com')).toEqual(canonicalSession);
    expect(revokes).toEqual([]);
  });

  it('a sign-out on PUBLIC_APP_URL still revokes and lands there, as before', async () => {
    const { trail } = await open(`${CANONICAL}/api/auth/logout`);

    expect(trail).toEqual([`${CANONICAL}/api/auth/logout`, `${CANONICAL}/login?signedout=1`]);
    expect(sessionOn('app.example.com')).toBeNull();
    expect(revokes).toHaveLength(1);
  });
});
