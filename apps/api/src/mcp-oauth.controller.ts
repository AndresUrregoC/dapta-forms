import { Controller, Get, Inject, NotFoundException } from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import type { McpOAuth, ProtectedResourceMetadata } from './mcp-oauth';
import { ENV, MCP_OAUTH } from './tokens';

/**
 * The protected-resource metadata of the MCP endpoint (RFC 9728): the
 * document a 401 from `/mcp` points at, naming the identity provider as the
 * authorization server, which is how a client discovers the login. Public and
 * credential-free by design. Not found while MCP OAuth is off or the MCP
 * endpoint is disabled.
 */
@Controller('.well-known/oauth-protected-resource')
export class McpOAuthMetadataController {
  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(MCP_OAUTH) private readonly oauth: McpOAuth | null,
  ) {}

  @Get('mcp')
  metadata(): ProtectedResourceMetadata {
    if (!this.oauth || !this.env.MCP_ENABLED) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return this.oauth.metadata();
  }
}
