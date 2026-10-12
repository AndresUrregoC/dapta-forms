/**
 * The rail's "Developers" item: in the list right after Integrations and before
 * Docs, in both rails (the desktop one, open or collapsed, and the mobile
 * drawer), and marked as the current page on its route.
 *
 * Both rails are in the server markup at once (the drawer is translated off
 * screen, not unmounted), so one render covers the desktop rail and the drawer.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getMessages, type Locale } from '@quill/shared';

const nav = vi.hoisted(() => ({ pathname: '/admin' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/components/ui/anchored-menu', () => ({
  AnchoredMenu: ({ children }: { children: ReactNode }) => <div data-menu>{children}</div>,
}));

import { AdminShell } from './admin-shell';

function render(opts: { pathname: string; collapsed?: boolean; locale?: Locale }) {
  nav.pathname = opts.pathname;
  const m = getMessages(opts.locale ?? 'en').admin;
  return renderToStaticMarkup(
    <AdminShell
      user={{ displayName: 'Alex Rivera', email: 'alex@example.com' }}
      messages={m.chrome}
      accountNav={m.account.nav}
      initialCollapsed={opts.collapsed ?? false}
    >
      <p>page</p>
    </AdminShell>,
  );
}

/** Every `<a>` that points at the Developers page, as written in the markup. */
const developerLinks = (html: string) => html.match(/<a [^>]*href="\/admin\/developers"[^>]*>/g) ?? [];

describe('AdminShell: Developers item', () => {
  it('appears in the desktop rail and in the mobile drawer', () => {
    const html = render({ pathname: '/admin' });
    expect(developerLinks(html)).toHaveLength(2);
    expect(html).toContain('pi-code');
  });

  it('sits after Integrations and before Docs', () => {
    const html = render({ pathname: '/admin' });
    const integrations = html.indexOf('href="/admin/integrations"');
    const developers = html.indexOf('href="/admin/developers"');
    const docs = html.indexOf('data-testid="nav-docs"');
    expect(integrations).toBeGreaterThan(-1);
    expect(developers).toBeGreaterThan(integrations);
    expect(docs).toBeGreaterThan(developers);
  });

  it('is the current page on its route and below it, and only there', () => {
    for (const pathname of ['/admin/developers', '/admin/developers/anything']) {
      const links = developerLinks(render({ pathname }));
      expect(links).toHaveLength(2);
      for (const a of links) expect(a).toContain('aria-current="page"');
    }
    for (const a of developerLinks(render({ pathname: '/admin/integrations' }))) {
      expect(a).not.toContain('aria-current');
    }
  });

  it('keeps a name on the collapsed rail, where only the icon shows', () => {
    const html = render({ pathname: '/admin/developers', collapsed: true });
    const [rail] = developerLinks(html);
    expect(rail).toContain('title="Developers"');
    expect(rail).toContain('aria-current="page"');
    expect(html).toContain('<span class="sr-only">Developers</span>');
  });

  it('takes its label from the catalog in both languages', () => {
    for (const locale of ['en', 'es'] as const) {
      const label = getMessages(locale).admin.chrome.nav.developers;
      expect(label.length).toBeGreaterThan(0);
      expect(render({ pathname: '/admin', locale })).toContain(`>${label}</span>`);
    }
  });
});
