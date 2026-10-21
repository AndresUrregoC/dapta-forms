/**
 * The MCP OAuth port: what the MCP server needs from the identity provider
 * that signs an MCP connection's token (see docs/adr/0001).
 *
 * dForms is only the resource server. It never runs a login, registers a
 * client or stores a token: the identity provider does all of that, and this
 * port only verifies the token a client presents and describes the resource
 * so the client can find the login (RFC 9728). The adapter is selected by
 * `MCP_OAUTH_PROVIDER`; with it unset there is no adapter and the MCP server
 * takes API keys only. Nothing outside the adapter knows which provider it is.
 */
import type { McpOAuthConfig } from '@quill/config/env';
import { createWorkosAuthKit } from './mcp-oauth.workos';

export { IssuerUnavailable } from './jwt-rs256';

/** A token that verified: who it names, in the identity provider's terms. */
export interface VerifiedAccess {
  /** The token's `sub`: the person, as the identity provider knows them. */
  subject: string;
}

/** The protected-resource metadata (RFC 9728) of the MCP endpoint. */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  resource_name: string;
}

export interface McpOAuth {
  /** The MCP endpoint as customers reach it: every token's audience. */
  readonly resource: string;
  /** Where `metadata()` is published; a 401 points clients at it. */
  readonly resourceMetadataUrl: string;
  metadata(): ProtectedResourceMetadata;
  /**
   * The identity provider's authorization server metadata (RFC 8414), as it
   * publishes it, for older clients that look for it on the MCP host itself.
   * Throws `IssuerUnavailable` when it cannot be read and none is cached.
   */
  authorizationServerMetadata(): Promise<Record<string, unknown>>;
  /**
   * The token's subject when it verifies, else null. Throws only
   * `IssuerUnavailable`, when the identity provider's keys cannot be read and
   * none are cached: an outage, not a bad token.
   */
  verify(token: string): Promise<VerifiedAccess | null>;
}

export interface McpOAuthDeps {
  fetch?: typeof fetch;
}

/** The configured adapter, or null when MCP OAuth is off. */
export function createMcpOAuth(config: McpOAuthConfig | null, deps: McpOAuthDeps = {}): McpOAuth | null {
  if (!config) return null;
  switch (config.provider) {
    case 'workos':
      return createWorkosAuthKit(config, deps);
  }
}
