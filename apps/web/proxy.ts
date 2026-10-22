import { NextResponse, type NextRequest } from 'next/server';
import { canonicalHop } from '@/lib/request-origin';
import { serverApiUrl } from '@/lib/api-url';

/** First path segments that are the app's own routes, never an account code. */
const APP_SEGMENTS = new Set(['admin', 'api', '_next', 'file', 'login', 'onboarding', 'preview', 'mcp']);

/** How long the existence check may take before the page is served as usual. */
export const FORM_CHECK_TIMEOUT_MS = 1_500;

/**
 * The `[accountCode, slug]` of a public form page (`/{code}/{anything}/{slug}`),
 * or null for every other path.
 */
function publicFormRoute(pathname: string): [string, string] | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 3) return null;
  const [code, , slug] = parts as [string, string, string];
  if (APP_SEGMENTS.has(code) || code.includes('.') || slug.includes('.')) return null;
  return [code, slug];
}

/**
 * A REAL 404 for a public form that does not exist (deleted, unpublished, a
 * typo), answered before the page renders.
 *
 * The page cannot do it itself: the root and the form's own `loading.tsx` are
 * Suspense boundaries, so Next 16 has flushed a 200 before the page's
 * `notFound()` runs, and a deleted form came back as "Not found" with HTTP 200.
 * Crawlers, link checkers and uptime monitors read that as a live page.
 *
 * Only a browser navigation is checked (a document load, in a tab or an embed's
 * iframe); the router's own fetches and prefetches go straight through. The
 * check FAILS OPEN: anything but the API's explicit 404 (a timeout, a 5xx, a
 * network error, a 429) serves the page exactly as before, which still shows
 * the not-found screen when the form is gone. The visitor's `X-Forwarded-For`
 * is forwarded verbatim, so the API's per-visitor rate limit sees the visitor
 * and not this server (see `lib/forwarded-for.ts`).
 *
 * The 404 itself is a rewrite to a path no route matches, which Next answers
 * with the app's own not-found screen and a 404 status; the address bar keeps
 * the URL the visitor asked for.
 */
async function missingFormResponse(req: NextRequest): Promise<NextResponse | null> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const mode = req.headers.get('sec-fetch-mode');
  if (mode !== null && mode !== 'navigate') return null;
  if (req.headers.get('rsc') || req.headers.get('next-router-prefetch')) return null;
  const route = publicFormRoute(req.nextUrl.pathname);
  if (!route) return null;
  const [code, slug] = route;
  try {
    const xff = req.headers.get('x-forwarded-for');
    const res = await fetch(
      `${serverApiUrl}/v1/public/forms/${encodeURIComponent(code)}/${encodeURIComponent(slug)}`,
      {
        cache: 'no-store',
        headers: xff ? { 'x-forwarded-for': xff } : {},
        signal: AbortSignal.timeout(FORM_CHECK_TIMEOUT_MS),
      },
    );
    if (res.status !== 404) return null;
  } catch {
    return null;
  }
  const url = req.nextUrl.clone();
  url.pathname = '/_form-not-found';
  url.search = '';
  return NextResponse.rewrite(url, { status: 404 });
}

/**
 * Keeps the session pages and the session refresh on the `PUBLIC_APP_URL` host.
 *
 * After a domain move the old host keeps serving, but the session cookie is
 * host-only and the login only starts on `PUBLIC_APP_URL`. An old link to the
 * dashboard (an owner email, a bookmark) therefore rendered on a host with no
 * session, whose 401 sent the browser to `/api/auth/refresh`, whose failure
 * sent it to the logout route on `PUBLIC_APP_URL`: the person was signed out
 * of the canonical host, upstream session included, by opening a link.
 *
 * So a GET or HEAD for these paths on any other hostname is answered with a
 * 302 to the same path and query on `PUBLIC_APP_URL` before anything reads a
 * cookie (`canonicalHop` holds the rules: hostname only, case-insensitive, no
 * `PUBLIC_APP_URL` = no hop, the target never taken from a header).
 *
 * Here and not in the admin layout: a layout renders in parallel with its page
 * and under a streamed 200, so its redirect can lose the race to the page's
 * own 401 and is never a real HTTP redirect; and it would not cover the wizard
 * or the refresh route. The proxy answers first, with a real 302, and the
 * matcher keeps every other path (public forms, embeds, `/embed.js`, files,
 * `/api/public/*`, `/_next/*`, OG images, icons) from running it at all.
 *
 * The dashboard and the wizard hop browser navigations only: a request whose
 * `Sec-Fetch-Mode` is `navigate`, or one without fetch metadata (curl, an old
 * client). A `fetch()` from a tab opened on the old host before the move (the
 * router's page loads, a Server Action's follow-up render, the editor's own
 * GETs) cannot follow a cross-origin redirect anyway, so a hop would only break
 * it; it keeps working on the host it came from, like that tab's POSTs. It
 * cannot carry the canonical host's cookies either, so it cannot reach that
 * host's session. The refresh route hops always: it is nothing but session
 * logic, and on another host it could only end on a redirect to the canonical
 * host's logout.
 */
export async function proxy(req: NextRequest): Promise<NextResponse> {
  const missing = await missingFormResponse(req);
  if (missing) return missing;
  if (publicFormRoute(req.nextUrl.pathname)) return NextResponse.next();
  return canonicalHopFor(req);
}

function canonicalHopFor(req: NextRequest): NextResponse {
  const fetchMode = req.headers.get('sec-fetch-mode');
  const navigation = fetchMode === null || fetchMode === 'navigate';
  if (!navigation && req.nextUrl.pathname !== '/api/auth/refresh') return NextResponse.next();

  const hop = canonicalHop(req);
  if (!hop) return NextResponse.next();
  // Next rewrites a proxy redirect aimed at the server's OWN listen address
  // into a relative Location, which the browser resolves against the host it
  // is already on: a loop. Only a local setup gets here (PUBLIC_APP_URL set to
  // the dev server's own address and the app opened under another name for it,
  // such as 127.0.0.1), and today's behavior is the right answer there.
  if (new URL(hop.headers.get('location')!).host === req.nextUrl.host) return NextResponse.next();
  return hop;
}

export const config = {
  // Exact paths: `/admin/:path*` is `/admin` and everything under it, the
  // wizard has no sub-pages (its `/onboarding/*.svg` logos are static files
  // that must keep loading anywhere), and the refresh is one route.
  // The fourth entry is the public form page (`/{code}/{anything}/{slug}`),
  // checked for a real 404 only; it never hops to another host. Three segments
  // exactly, none with a dot (an asset), and never under one of the app's own
  // first segments: `/api/auth/login` must not run it.
  matcher: [
    '/admin/:path*',
    '/onboarding',
    '/api/auth/refresh',
    '/:accountCode((?!(?:admin|api|_next|file|login|onboarding|preview|mcp)/)[^/.]+)/:handle/:slug([^/.]+)',
  ],
};
