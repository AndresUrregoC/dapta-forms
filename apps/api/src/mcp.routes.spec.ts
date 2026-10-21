/**
 * The MCP calls controller handlers in process, so the app-wide
 * `ApiKeyRouteGuard` never runs for it. These pin the replacement: every
 * handler the MCP may call has route metadata, and that route is on the
 * API-key allowlist. A tool that reached for any other handler fails here,
 * and fails the boot too (`McpController.onModuleInit`).
 */
import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Controller, ForbiddenException, Get, type ExecutionContext } from '@nestjs/common';
import { AdminCrudController } from './admin-crud.controller';
import { AnalyticsController } from './analytics.controller';
import { ApiKeyRouteGuard, isKeyAllowedRoute, routeOf } from './api-key-routes';
import { inProcessRequest } from './in-process-principal';
import { MCP_ANALYTICS_HANDLERS, MCP_FORM_HANDLERS, keyAllowedRoutes } from './mcp.backend';

const cases: Array<[string, new (...args: never[]) => object, readonly string[]]> = [
  ['AdminCrudController', AdminCrudController, MCP_FORM_HANDLERS],
  ['AnalyticsController', AnalyticsController, MCP_ANALYTICS_HANDLERS],
];

describe('the handlers the MCP calls', () => {
  for (const [label, controller, names] of cases) {
    for (const name of names) {
      it(`${label}.${name} is a route an API key may call`, () => {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        expect(typeof handler, `${label}.${name} exists`).toBe('function');
        const route = routeOf(controller, handler as object);
        expect(route, `${label}.${name} has route metadata`).not.toBeNull();
        expect(isKeyAllowedRoute(route!), route!).toBe(true);
      });
    }
  }

  it('maps to exactly the routes the tools need', () => {
    expect([...keyAllowedRoutes(AdminCrudController, MCP_FORM_HANDLERS), ...keyAllowedRoutes(AnalyticsController, MCP_ANALYTICS_HANDLERS)]).toEqual([
      'GET /v1/me',
      'GET /v1/forms',
      'GET /v1/forms/:id',
      'POST /v1/forms',
      'PUT /v1/forms/:id',
      'POST /v1/forms/:id/publish',
      'POST /v1/forms/:id/revert',
      'GET /v1/forms/:id/submissions',
      'GET /v1/forms/:id/analytics',
    ]);
  });
});

describe('keyAllowedRoutes', () => {
  it('refuses a handler whose route is not on the API-key allowlist', () => {
    // GET /v1/members is dashboard only.
    expect(() => keyAllowedRoutes(AdminCrudController, ['members'])).toThrow(/not on the API-key route allowlist/);
  });

  it('refuses a handler with no route metadata, or no such handler', () => {
    @Controller('v1')
    class Fake {
      @Get('forms')
      routed() {
        return null;
      }
      plain() {
        return null;
      }
    }
    expect(keyAllowedRoutes(Fake, ['routed'])).toEqual(['GET /v1/forms']);
    expect(() => keyAllowedRoutes(Fake, ['plain'])).toThrow(/has no route/);
    expect(() => keyAllowedRoutes(Fake, ['missing'])).toThrow(/has no route/);
  });
});

describe('the in-process principal', () => {
  // The MCP's in-process requests never pass through Nest's pipeline today;
  // should one ever be dispatched through it, the guard holds it to the same
  // allowlist as a key, whether it carries a key or is an MCP connection.
  const guard = new ApiKeyRouteGuard();
  const contextFor = (handler: object, req: object): ExecutionContext =>
    ({
      getType: () => 'http',
      getClass: () => AdminCrudController,
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    }) as unknown as ExecutionContext;
  const principals = [
    ['an MCP connection', { accountId: 'a', memberId: 'm' }],
    ['an API key through the MCP', { accountId: 'a', memberId: 'm', apiKeyHash: 'h' }],
  ] as const;

  it('is built for a handler only by the MCP backend, so the boot check above covers every one', () => {
    const dir = __dirname;
    const builders = readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && f !== 'in-process-principal.ts')
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('inProcessRequest('));
    expect(builders).toEqual(['mcp.backend.ts']);
  });

  for (const [label, principal] of principals) {
    it(`${label} is refused a route outside the allowlist and let through one on it`, () => {
      const p = AdminCrudController.prototype;
      expect(() => guard.canActivate(contextFor(p.members, inProcessRequest(principal)))).toThrow(ForbiddenException);
      expect(guard.canActivate(contextFor(p.createForm, inProcessRequest(principal)))).toBe(true);
    });
  }
});
