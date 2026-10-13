/**
 * The Developers page as the server renders it: the keys the API returned (or
 * the error state when it could not answer), shown for the caller's role, and
 * the docs section next to them, in the reader's language.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { getMessages, type Locale } from '@quill/shared';

const me = vi.fn();
const listApiKeys = vi.fn();
const locale = vi.hoisted(() => ({ value: 'en' as Locale }));

vi.mock('@/lib/admin-api', () => ({
  adminApi: {
    me: (...a: unknown[]) => me(...a),
    listApiKeys: (...a: unknown[]) => listApiKeys(...a),
  },
  isAdminRole: (role: string) => role === 'owner' || role === 'admin',
}));
vi.mock('@/lib/locale', () => ({ getLocale: async () => locale.value }));
vi.mock('next/navigation', () => ({
  // Like the real one for what matters here: a redirect is rethrown, anything else is not.
  unstable_rethrow: (e: unknown) => {
    if ((e as { digest?: string } | null)?.digest === 'NEXT_REDIRECT') throw e;
  },
}));
// The docs section is an async server component with its own spec; stub it
// with a synchronous one so this static render stays about the page.
vi.mock('./developer-docs', async () => {
  const { getMessages: messages } = await vi.importActual<typeof import('@quill/shared')>('@quill/shared');
  return {
    DeveloperDocs: ({ locale: lang }: { locale?: Locale }) => (
      <section data-testid="developer-docs">{messages(lang ?? 'en').admin.developerDocs.title}</section>
    ),
  };
});
vi.mock('./actions', () => ({
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

  it('shows the docs section, in Spanish for a Spanish reader', async () => {
    locale.value = 'es';
    me.mockResolvedValue(caller('member'));
    listApiKeys.mockResolvedValue({ keys: [] });
    const html = await render();
    const es = getMessages('es').admin;
    expect(html).toContain('data-testid="developer-docs"');
    expect(html).toContain(es.developerDocs.title);
    expect(html).toContain(es.developers.keys.emptyTitle);
  });
});
