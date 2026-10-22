import { Body, Controller, Get, Inject, NotFoundException, Put, Req } from '@nestjs/common';
import { linkPageSchema } from '@quill/types';
import { AuthService, type ReqLike } from './auth.service';
import { LinkPageService } from './link-page.service';
import { parse } from './validation';

/**
 * The workspace link page editor (`/v1/link-page`).
 *
 * Any member of the workspace may read and write it: the page belongs to the
 * workspace, not to one person, and the team decided not to gate it on a role.
 * Both routes still resolve the principal and act only on ITS workspace; the
 * workspace is never taken from the request body.
 *
 * Not open to API keys yet (see `api-key-routes.ts`): adding a route there
 * also means documenting it in the API reference and giving it an MCP tool or
 * an exclusion, and the MCP is being worked on separately.
 */
@Controller('v1/link-page')
export class LinkPageController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(LinkPageService) private readonly pages: LinkPageService,
  ) {}

  /** The stored page (or null), the workspace's forms and its brand kit, for the editor and its preview. */
  @Get()
  async get(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    const view = await this.pages.editorView(p.accountId, p.memberId);
    if (!view) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return view;
  }

  /**
   * Replace the workspace's page. `{ page: null }` removes it, which is the
   * same as never having had one: the public URL goes back to 404.
   */
  @Put()
  async put(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const raw = (body as { page?: unknown } | null)?.page ?? null;
    const page = raw == null ? null : parse(linkPageSchema, raw);
    const saved = await this.pages.save(p.accountId, page);
    return { ok: true, page: saved };
  }
}
