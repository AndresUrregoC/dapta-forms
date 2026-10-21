import { randomUUID } from 'node:crypto';
import { All, Controller, Inject, Logger, OnModuleInit, Req, Res } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Db } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import { FormsMcpServer, McpDoor, isConnection, unlimited, type DoorRequest, type DoorResponse, type RateLimiter } from '@quill/mcp';
import { AdminCrudController } from './admin-crud.controller';
import { AnalyticsController } from './analytics.controller';
import {
  ApiFormsBackend,
  MCP_ANALYTICS_HANDLERS,
  MCP_FORM_HANDLERS,
  authenticateMcpConnection,
  authenticateMcpKey,
  keyAllowedRoutes,
  type McpHandlers,
} from './mcp.backend';
import { noteApiKeyCall } from './deprecated-hosts';
import { API_KEY_PREFIX } from './api-keys';
import type { McpOAuth } from './mcp-oauth';
import type { PersonDirectory } from './person-directory';
import { TokenBucketRateLimiter, clientKey, resolveTrustProxyHops } from './rate-limit';
import { DB, ENV, MCP_OAUTH, PERSON_DIRECTORY, RATE_LIMITER } from './tokens';

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A caller's own request id when it is a short safe token, else a fresh one. */
function requestIdFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && /^[A-Za-z0-9._:-]{8,64}$/.test(value) ? value : randomUUID();
}

/**
 * `POST /mcp`: the dForms MCP server (`@quill/mcp`), mounted in forms-api so it
 * ships with the normal release, needs no new deployment and no new
 * credential.
 *
 * The package's door does the guarding (switch, method, Host, Origin, URL
 * credentials, content type, API key, rate limits); this controller only
 * wires it to the app: the key lookup, the client address behind the trusted
 * proxies, the limiters, and the backend that runs each tool through the
 * app's own form handlers (see `ApiFormsBackend`).
 */
@Controller('mcp')
export class McpController implements OnModuleInit {
  private readonly logger = new Logger('Mcp');
  readonly server: FormsMcpServer;
  private readonly door: McpDoor;
  private readonly trustProxyHops: number;
  private handlers: McpHandlers | null = null;

  constructor(
    @Inject(ENV) env: ServerEnv,
    @Inject(DB) db: Db,
    // The public per-IP bucket: requests without a valid key are charged to it.
    @Inject(RATE_LIMITER) ipLimiter: RateLimiter,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
    // MCP connections over OAuth: both null unless MCP_OAUTH_PROVIDER is set.
    @Inject(MCP_OAUTH) oauth: McpOAuth | null,
    @Inject(PERSON_DIRECTORY) directory: PersonDirectory | null,
  ) {
    this.trustProxyHops = resolveTrustProxyHops(env);
    const bucket = (capacity: number, refill: number): RateLimiter =>
      env.RATE_LIMIT_ENABLED ? new TokenBucketRateLimiter(capacity, refill) : unlimited;
    this.server = new FormsMcpServer({
      backend: new ApiFormsBackend(db, () => this.resolveHandlers()),
      toolTimeoutMs: env.MCP_TOOL_TIMEOUT_MS,
      writeLimiter: bucket(env.MCP_WRITE_RATE_LIMIT_CAPACITY, env.MCP_WRITE_RATE_LIMIT_REFILL_PER_SEC),
      // Named to a signed-in person with no workspace yet: open dForms once there.
      appUrl: env.PUBLIC_APP_URL,
      onInternalError: (tool, requestId, error) =>
        this.logger.error(`tool ${tool} failed (${requestId})`, error instanceof Error ? error.stack : String(error)),
      onTransportError: (error) => this.logger.warn(`mcp transport: ${error.message}`),
    });
    this.door = new McpDoor({
      server: this.server,
      enabled: env.MCP_ENABLED,
      allowedOrigins: csv(env.MCP_ALLOWED_ORIGINS),
      allowedHosts: csv(env.MCP_ALLOWED_HOSTS),
      authenticate: (token) => authenticateMcpKey(db, token),
      // A `dforms_` bearer takes the key path above; any other is an access
      // token of the identity provider. Off: every bearer is a key, as before.
      oauth:
        oauth && directory
          ? {
              isApiKey: (token) => token.startsWith(API_KEY_PREFIX),
              authenticate: (token) => authenticateMcpConnection(db, oauth, directory, token, env.PUBLIC_APP_URL),
              resourceMetadataUrl: oauth.resourceMetadataUrl,
            }
          : undefined,
      // A key call on a deprecated API host is logged by key id, like REST.
      onAuthenticated: (req, credential) => {
        if (!isConnection(credential)) noteApiKeyCall(req, credential.credentialId, credential.accountId);
      },
      keyLimiter: bucket(env.MCP_RATE_LIMIT_CAPACITY, env.MCP_RATE_LIMIT_REFILL_PER_SEC),
      ipLimiter,
    });
  }

  /**
   * The form handlers live in the app's other controllers; resolved once the
   * module is built. Boot fails here if any handler the MCP calls is not a
   * route an API key may call (see `keyAllowedRoutes`), because the app-wide
   * key guard never sees in-process calls.
   */
  onModuleInit(): void {
    this.resolveHandlers();
  }

  private resolveHandlers(): McpHandlers {
    if (!this.handlers) {
      keyAllowedRoutes(AdminCrudController, MCP_FORM_HANDLERS);
      keyAllowedRoutes(AnalyticsController, MCP_ANALYTICS_HANDLERS);
      this.handlers = {
        forms: this.moduleRef.get(AdminCrudController, { strict: false }),
        analytics: this.moduleRef.get(AnalyticsController, { strict: false }),
      };
    }
    return this.handlers;
  }

  @All()
  async serve(@Req() req: DoorRequest & { ip?: string; socket?: { remoteAddress?: string } }, @Res() res: DoorResponse): Promise<void> {
    await this.door.handle(req, res, {
      ip: clientKey(req, this.trustProxyHops),
      requestId: requestIdFrom(req.headers['x-request-id']),
    });
  }
}
