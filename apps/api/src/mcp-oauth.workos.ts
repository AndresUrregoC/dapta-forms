/**
 * The WorkOS AuthKit adapter of the MCP OAuth port, selected by
 * `MCP_OAUTH_PROVIDER=workos`. The only place that knows AuthKit's layout:
 * the issuer is the AuthKit domain, its signing keys are published at
 * `/oauth2/jwks`, and it is the authorization server clients log in with
 * (dynamic client registration, consent and tokens all happen there).
 *
 * The rules are the ones the sibling MCP server applies to the same tokens:
 * RS256 against the issuer's keys, `iss` the configured domain, `aud` the
 * configured resource, `sub` and `exp` required. Every value comes from the
 * environment; no host or id of the hosted deployment is written here.
 */
import type { McpOAuthConfig } from '@quill/config/env';
import { RemoteJwks, verifyRs256 } from './jwt-rs256';
import type { McpOAuth, McpOAuthDeps } from './mcp-oauth';

export function createWorkosAuthKit(config: McpOAuthConfig, deps: McpOAuthDeps = {}): McpOAuth {
  const jwks = new RemoteJwks(`${config.issuer}/oauth2/jwks`, { fetch: deps.fetch });
  return {
    resource: config.resource,
    resourceMetadataUrl: config.resourceMetadataUrl,
    metadata: () => ({
      resource: config.resource,
      authorization_servers: [config.issuer],
      bearer_methods_supported: ['header'],
      resource_name: 'dForms',
    }),
    async verify(token) {
      const claims = await verifyRs256(token, {
        issuer: config.issuer,
        audience: config.resource,
        keyFor: (kid) => jwks.keyFor(kid),
      });
      return claims ? { subject: claims.sub } : null;
    },
  };
}
