/**
 * The MCP serves everything the API docs page documents, no more and no
 * less. The page renders `API_REFERENCE`; these walk it and fail when a
 * documented route has no MCP tool (and is not excluded on purpose, with a
 * reason), when a tool does not reach that route's own handler, or when the
 * tool's role and destructive marks disagree with the reference.
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { API_ROUTE_EXCLUSIONS, API_ROUTE_TOOLS, CATALOG } from '@quill/mcp';
import { API_REFERENCE, apiEndpoints } from '@quill/shared';
import { AdminCrudController } from './admin-crud.controller';
import { AnalyticsController } from './analytics.controller';
import { BrandingController } from './branding.controller';
import { FormDestinationsController, IntegrationsController } from './integrations.controller';
import { MCP_ANALYTICS_HANDLERS, MCP_FORM_HANDLERS, keyAllowedRoutes } from './mcp.backend';
import { CsvCollector, MCP_PARITY_HANDLERS } from './mcp.backend.parity';

const tools = new Map(CATALOG.map((t) => [t.name, t]));

describe('the MCP against the API reference', () => {
  it('has a tool for every documented route, or an exclusion that says why', () => {
    const uncovered = apiEndpoints()
      .map((e) => e.route)
      .filter((route) => !API_ROUTE_TOOLS[route] && !API_ROUTE_EXCLUSIONS[route]);
    expect(uncovered).toEqual([]);
    for (const [route, reason] of Object.entries(API_ROUTE_EXCLUSIONS)) expect(reason.trim(), route).not.toBe('');
  });

  it('names only routes the reference documents, and only tools the server registers', () => {
    const documented = new Set(Object.keys(API_REFERENCE));
    for (const route of [...Object.keys(API_ROUTE_TOOLS), ...Object.keys(API_ROUTE_EXCLUSIONS)]) expect(documented.has(route), route).toBe(true);
    for (const [route, tool] of Object.entries(API_ROUTE_TOOLS)) expect(tools.has(tool), `${route} -> ${tool}`).toBe(true);
  });

  it("reaches every mapped route through that route's own handler, each one callable with an API key", () => {
    const reached = new Set([
      ...keyAllowedRoutes(AdminCrudController, MCP_FORM_HANDLERS),
      ...keyAllowedRoutes(AnalyticsController, MCP_ANALYTICS_HANDLERS),
      ...keyAllowedRoutes(AdminCrudController, MCP_PARITY_HANDLERS.forms),
      ...keyAllowedRoutes(AnalyticsController, MCP_PARITY_HANDLERS.analytics),
      ...keyAllowedRoutes(FormDestinationsController, MCP_PARITY_HANDLERS.destinations),
      ...keyAllowedRoutes(BrandingController, MCP_PARITY_HANDLERS.branding),
      ...keyAllowedRoutes(IntegrationsController, MCP_PARITY_HANDLERS.integrations),
    ]);
    expect([...reached].sort()).toEqual(Object.keys(API_ROUTE_TOOLS).sort());
  });

  it('marks a tool destructive whenever the reference marks its route destructive', () => {
    for (const e of apiEndpoints()) {
      const tool = tools.get(API_ROUTE_TOOLS[e.route] ?? '');
      if (!tool) continue;
      if (e.destructive) expect(tool.annotations.destructiveHint, `${e.route} -> ${tool.name}`).toBe(true);
      if (e.method === 'GET') expect(tool.annotations.readOnlyHint, `${e.route} -> ${tool.name}`).toBe(true);
      else expect(tool.write, `${e.route} -> ${tool.name}`).toBe(true);
    }
  });

  it('tells the agent which tools are for owners and admins, as the reference does', () => {
    for (const e of apiEndpoints()) {
      const tool = tools.get(API_ROUTE_TOOLS[e.route] ?? '');
      if (!tool) continue;
      expect(/Owners and admins only/.test(tool.description), `${e.route} -> ${tool.name}`).toBe(e.adminOnly === true);
    }
  });
});

describe('the CSV an agent gets', () => {
  const rows = (c: CsvCollector, lines: string[]) => {
    c.write('\uFEFFQ1,Q2\r\n');
    for (const line of lines) c.write(`${line}\r\n`);
    return c.result();
  };

  it('keeps the header without its byte-order mark, and the first rows only', () => {
    expect(rows(new CsvCollector(2, 1_000), ['a,1', 'b,2', 'c,3'])).toEqual({
      csv: 'Q1,Q2\r\na,1\r\nb,2',
      rows: 2,
      totalRows: 3,
      truncated: true,
    });
  });

  it('stops at the first row past the size cap, so no row in the middle goes missing', () => {
    const out = rows(new CsvCollector(10, 12), ['a,1', 'x'.repeat(20), 'b,2']);
    expect(out).toMatchObject({ csv: 'Q1,Q2\r\na,1', rows: 1, totalRows: 3, truncated: true });
  });
});
