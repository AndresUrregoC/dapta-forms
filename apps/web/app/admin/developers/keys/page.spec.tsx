/**
 * The API keys page as the server renders it: the keys the API returned (or
 * the error state when it could not answer), shown for the caller's role, and
 * a link to the API docs page, in the reader's language. The docs themselves
 * are not on this page any more.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import type { ReactElement } from 'react';
import { getMessages, type Locale } from '@quill/shared';

const me = vi.fn();
const listApiKeys = vi.fn();
const locale = vi.hoisted(() => ({ value: 'en' as Locale }));
const apiUrl = vi.hoisted(() => ({ value: 'https://api.forms.example.com' as string | null }));

vi.mock('@/lib/admin-api', () => ({
  adminApi: {
    me: (...a: unknown[]) => me(...a),
    listApiKeys: (...a: unknown[]) => listApiKeys(...a),
  },
  isAdminRole: (role: string) => role === 'owner' || role === 'admin',
}));
vi.mock('@/lib/locale', () => ({ getLocale: async () => locale.value }));
vi.mock('@/lib/developer-skill/public-api-url', () => ({ publicApiUrl: () => apiUrl.value }));
vi.mock('next/navigation', () => ({
  // Like the real one for what matters here: a redirect is rethrown, anything else is not.
  unstable_rethrow: (e: unknown) => {
    if ((e as { digest?: string } | null)?.digest === 'NEXT_REDIRECT') throw e;
  },
}));
vi.mock('../actions', () => ({
  createApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
}));

import DevelopersPage from './page';

const caller = (role: 'owner' | 'admin' | 'member') => ({
  memberId: 'mem-me',
  role,
  displayName: 'Alex Rivera',
  email: 'alex@example.com',
  timezone: 'America/Bogota',
});

const keys = [
  {
    id: 'key-1',
    name: 'Claude Code',
    last4: 'k1k1',
    createdAt: Date.UTC(2026, 9, 1),
    lastUsedAt: null,
    createdBy: { memberId: 'mem-me', name: 'Alex Rivera', email: 'alex@example.com' },
  },
];

const render = async () => renderToStaticMarkup((await DevelopersPage()) as ReactElement);

describe('DevelopersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locale.value = 'en';
    apiUrl.value = 'https://api.forms.example.com';
  });

  it('is titled after the rail section, MCP', async () => {
    me.mockResolvedValue(caller('member'));
    listApiKeys.mockResolvedValue({ keys });
    const html = await render();
    expect(html).toMatch(/<h1[^>]*>MCP<\/h1>/);
    expect(html).not.toContain('Developers');
  });

  it('lists the keys the API returned, without the Created by column for a member', async () => {
    me.mockResolvedValue(caller('member'));
    listApiKeys.mockResolvedValue({ keys });
    const html = await render();
    const m = getMessages('en').admin;
    expect(html).toContain(m.developers.title);
    expect(html).toContain('data-testid="api-key-row"');
    expect(html).not.toContain(m.developers.keys.colCreatedBy);
  });

  it('adds the Created by column for an owner', async () => {
    me.mockResolvedValue(caller('owner'));
    listApiKeys.mockResolvedValue({ keys });
    const html = await render();
    expect(html).toContain(getMessages('en').admin.developers.keys.colCreatedBy);
  });

  it('renders the error state when the keys cannot be read', async () => {
    me.mockResolvedValue(caller('member'));
    listApiKeys.mockRejectedValue(new Error('API down'));
    const html = await render();
    const m = getMessages('en').admin.developers.keys;
    expect(html).toContain(m.loadError);
    expect(html).not.toContain(m.emptyTitle);
  });

  it('lets a redirect from the key list escape instead of showing the error state', async () => {
    me.mockResolvedValue(caller('member'));
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT' });
    listApiKeys.mockRejectedValue(redirect);
    await expect(render()).rejects.toBe(redirect);
  });

  it('links to the API docs instead of carrying them, in Spanish for a Spanish reader', async () => {
    locale.value = 'es';
    me.mockResolvedValue(caller('member'));
    listApiKeys.mockResolvedValue({ keys: [] });
    const html = await render();
    const es = getMessages('es').admin;
    const link = html.match(/<a [^>]*data-testid="api-docs-link"[^>]*>.*?<\/a>/)?.[0] ?? '';
    expect(link).toContain('href="/admin/developers/docs"');
    expect(link).toContain(es.chrome.developersMenu.docs);
    expect(html).toContain(es.developers.keys.emptyTitle);
    expect(html).not.toContain(es.developerDocs.title);
  });

  describe('setup guide', () => {
    const download = (html: string) =>
      html.match(/<a [^>]*data-testid="api-keys-skill-download"[^>]*>.*?<\/a>/)?.[0];
    /**
     * The text a reader sees: the markup parsed by a real HTML parser and its
     * text read back, so the code highlight's spans are gone and entities are
     * decoded.
     */
    const reader = new Window();
    afterAll(() => reader.happyDOM.close());
    const decode = (html: string) => {
      const template = reader.document.createElement('template');
      template.innerHTML = html;
      return template.content.textContent ?? '';
    };

    afterEach(() => {
      delete process.env.MCP_PUBLIC_URL;
    });

    it('opens the page with the three steps above the keys, and the skill below them', async () => {
      me.mockResolvedValue(caller('member'));
      listApiKeys.mockResolvedValue({ keys });
      const html = await render();
      const m = getMessages('en').admin;
      expect(html).toContain(m.developers.guide.title);
      // Key, agent, try, then the skill alternative, all of it before the list.
      const at = (id: string) => html.indexOf(`data-testid="${id}"`);
      expect(at('setup-step-key')).toBeGreaterThan(-1);
      expect(at('setup-step-key')).toBeLessThan(at('setup-step-agent'));
      expect(at('setup-step-agent')).toBeLessThan(at('setup-step-try'));
      expect(at('setup-step-try')).toBeLessThan(at('setup-skill'));
      expect(at('setup-guide')).toBeLessThan(at('api-keys'));
      const link = download(html)!;
      expect(link).toContain('href="/api/developers/skill"');
      expect(link).toMatch(/\sdownload=""/);
      expect(link).toContain(m.developerDocs.skillButton);
    });

    it('points the agent at the MCP endpoint of the public API, read at request time', async () => {
      me.mockResolvedValue(caller('member'));
      listApiKeys.mockResolvedValue({ keys });
      const html = decode(await render());
      expect(html).toContain('claude mcp add --transport http dforms https://api.forms.example.com/mcp');
      expect(html).toContain("--header 'Authorization: Bearer ${DFORMS_API_KEY}'");
    });

    it('prefers MCP_PUBLIC_URL from the server environment when it is set', async () => {
      process.env.MCP_PUBLIC_URL = 'https://mcp.forms.example.com/mcp/';
      me.mockResolvedValue(caller('member'));
      listApiKeys.mockResolvedValue({ keys });
      const html = decode(await render());
      expect(html).toContain('claude mcp add --transport http dforms https://mcp.forms.example.com/mcp \\');
      expect(html).not.toContain('https://api.forms.example.com/mcp');
    });

    it('is there with no keys yet and when the list failed: it does not depend on them', async () => {
      me.mockResolvedValue(caller('member'));
      listApiKeys.mockResolvedValue({ keys: [] });
      expect(download(await render())).toBeDefined();
      listApiKeys.mockRejectedValue(new Error('API down'));
      expect(download(await render())).toBeDefined();
    });

    it('says what is unavailable instead of links that would fail, without a public API address', async () => {
      apiUrl.value = null;
      me.mockResolvedValue(caller('member'));
      listApiKeys.mockResolvedValue({ keys });
      const html = await render();
      const m = getMessages('en').admin;
      expect(download(html)).toBeUndefined();
      expect(html).toContain(m.developerDocs.skillUnavailable);
      expect(decode(html)).toContain(m.developers.guide.mcpUnavailable);
      expect(html).not.toContain('claude mcp add');
    });

    describe('the two paths: a chat app with a sign-in, a terminal agent with a key', () => {
      const section = (html: string, id: string) => {
        const start = html.indexOf(`data-testid="${id}"`);
        if (start < 0) return '';
        const open = html.lastIndexOf('<section', start);
        return html.slice(open, html.indexOf('</section>', start) + '</section>'.length);
      };

      afterEach(() => {
        delete process.env.MCP_OAUTH_PROVIDER;
      });

      it('with OAuth off, shows the key guide alone, as before: no chat path, and the note that chat apps cannot connect yet', async () => {
        me.mockResolvedValue(caller('member'));
        listApiKeys.mockResolvedValue({ keys });
        const html = await render();
        const m = getMessages('en').admin.developers;
        expect(html).not.toContain('data-testid="mcp-path-chat"');
        expect(html).toContain(m.subtitle);
        expect(decode(section(html, 'setup-guide'))).toContain(m.guide.title);
        expect(decode(html)).toContain(m.guide.chatNote);
        expect(html).not.toContain(m.guide.terminal.title);
      });

      it('with OAuth on, puts the chat path first with the URL of this environment, then the key guide for terminal agents, then the keys', async () => {
        process.env.MCP_OAUTH_PROVIDER = 'workos';
        process.env.MCP_PUBLIC_URL = 'https://mcp.forms.example.com/mcp';
        me.mockResolvedValue(caller('member'));
        listApiKeys.mockResolvedValue({ keys });
        const html = await render();
        const m = getMessages('en').admin.developers;
        const at = (id: string) => html.indexOf(`data-testid="${id}"`);
        expect(at('mcp-path-chat')).toBeGreaterThan(-1);
        expect(at('mcp-path-chat')).toBeLessThan(at('setup-guide'));
        expect(at('setup-guide')).toBeLessThan(at('api-keys'));

        const chat = decode(section(html, 'mcp-path-chat'));
        expect(chat).toContain(m.guide.chat.title);
        expect(chat).toContain('https://mcp.forms.example.com/mcp');
        // Both chat apps, each with its own steps, both on screen at once.
        for (const step of [...m.guide.chat.claude.steps, ...m.guide.chat.chatgpt.steps]) expect(chat).toContain(step);
        // No key on this path: nothing to export, no header to send.
        expect(chat).not.toContain('DFORMS_API_KEY');

        const terminal = decode(section(html, 'setup-guide'));
        expect(terminal).toContain(m.guide.terminal.title);
        expect(terminal).toContain('claude mcp add --transport http dforms https://mcp.forms.example.com/mcp');
        // The "chat apps cannot connect yet" note would now be false.
        expect(decode(html)).not.toContain(m.guide.chatNote);
        expect(html).toContain(m.subtitleOauth);
        expect(html).not.toContain(`>${m.subtitle}<`);
      });

      it('with the provider set but no MCP_PUBLIC_URL, offers no chat path: the address it would derive is not the audience the API checks', async () => {
        process.env.MCP_OAUTH_PROVIDER = 'workos';
        me.mockResolvedValue(caller('member'));
        listApiKeys.mockResolvedValue({ keys });
        const html = await render();
        const m = getMessages('en').admin.developers;
        expect(html).not.toContain('data-testid="mcp-path-chat"');
        expect(html).toContain(m.subtitle);
        expect(decode(html)).toContain(m.guide.chatNote);
      });

      it('with OAuth on, speaks Spanish to a Spanish reader on both paths', async () => {
        process.env.MCP_OAUTH_PROVIDER = 'workos';
        process.env.MCP_PUBLIC_URL = 'https://mcp.forms.example.com/mcp';
        locale.value = 'es';
        me.mockResolvedValue(caller('member'));
        listApiKeys.mockResolvedValue({ keys });
        const html = await render();
        const es = getMessages('es').admin.developers;
        const chat = decode(section(html, 'mcp-path-chat'));
        expect(chat).toContain(es.guide.chat.title);
        expect(chat).toContain(es.guide.chat.claude.steps[0]);
        expect(chat).toContain(es.guide.chat.chatgpt.steps[0]);
        expect(decode(section(html, 'setup-guide'))).toContain(es.guide.terminal.title);
        expect(html).toContain(es.subtitleOauth);
        expect(decode(html)).not.toContain(es.guide.chatNote);
      });
    });

    it('speaks Spanish to a Spanish reader', async () => {
      locale.value = 'es';
      me.mockResolvedValue(caller('member'));
      listApiKeys.mockResolvedValue({ keys });
      const html = await render();
      const es = getMessages('es').admin;
      expect(decode(html)).toContain(es.developers.guide.title);
      expect(decode(html)).toContain(es.developers.guide.mcpLabel);
      expect(download(html)).toContain(es.developerDocs.skillButton);
    });
  });
});
