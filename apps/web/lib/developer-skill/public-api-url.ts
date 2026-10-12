/**
 * The API address a CUSTOMER should call, as opposed to the one this server
 * calls (`serverApiUrl`).
 *
 * The two differ in a real deployment. `API_URL` exists so server-to-server
 * calls can stay inside the cluster, which means it may name an address that
 * only resolves there; printing it in the Developers docs, or baking it into
 * the skill zip, would hand an agent a host it can never reach. So:
 *
 * 1. `PUBLIC_API_URL`, read at runtime like `API_URL` (no `NEXT_PUBLIC_`
 *    prefix, so one built image serves every environment). This is the knob a
 *    deployment sets.
 * 2. `API_URL`, when it does not look cluster-internal. A fork that runs the
 *    API on a public host usually points the web at that same host.
 * 3. `NEXT_PUBLIC_API_URL`, only when `API_URL` is unset: that is the fork or
 *    `pnpm dev` that configures nothing else. When `API_URL` IS set, the public
 *    variable was frozen into the image at build time and may name another
 *    environment's host, so it is not trusted for this.
 * 4. `http://localhost:4000` when none of the three is set, the same default
 *    `serverApiUrl` uses for a bare clone.
 *
 * Null when the variables are set but none of them is usable: the docs then say
 * so instead of guessing, and the skill route refuses rather than ship a zip
 * that points nowhere.
 */
export function publicApiUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = clean(env.PUBLIC_API_URL);
  if (explicit) return explicit;

  const server = env.API_URL?.trim();
  if (server) {
    const url = clean(server);
    return url && !looksInternal(url) ? url : null;
  }

  const baked = env.NEXT_PUBLIC_API_URL?.trim();
  if (baked) {
    const url = clean(baked);
    return url && !looksInternal(url) ? url : null;
  }

  return 'http://localhost:4000';
}

/** An absolute http(s) URL with no trailing slash, or null. */
function clean(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // Keep a path prefix (an API mounted under /forms-api), drop query and hash.
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/**
 * A host only a cluster or a private network can resolve: a single label that
 * is not `localhost` (a Docker Compose or Kubernetes service name), or one of
 * the suffixes those networks use.
 */
function looksInternal(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return false;
  if (!host.includes('.')) return true;
  return /\.(local|internal|svc|cluster\.local|localdomain)$/.test(host);
}
