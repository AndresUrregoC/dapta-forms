import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { adminApi, type ApiKey } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { PageHeader } from '@/components/ui/page-header';
import { buttonVariants } from '@/components/ui/button';
import { ApiKeysPanel } from '../api-keys';

export const dynamic = 'force-dynamic';

/**
 * Developers, API keys: where a person creates the key that connects an AI
 * agent (or their own code) to this workspace. Key management only; what a
 * key can call lives on the docs page next door (`/admin/developers/docs`),
 * linked from the header.
 *
 * The keys come from `GET /v1/api-keys`, which already scopes them by role (a
 * member gets their own, an owner or admin all of the workspace's). A failed
 * read renders the error state rather than an empty list, so nobody is told
 * they have no keys when the truth is that nobody could check.
 */
export default async function DeveloperKeysPage() {
  const locale = await getLocale();
  const m = getMessages(locale).admin;
  // Independent reads, so in parallel. A failed key list is the error state;
  // a failed `/v1/me` throws like on every other admin page.
  const [me, listed] = await Promise.all([
    adminApi.me(),
    adminApi.listApiKeys().then(
      (r) => ({ ok: true as const, keys: r.keys }),
      (e: unknown) => ({ ok: false as const, error: e }),
    ),
  ]);

  let keys: ApiKey[] = [];
  let loadError = false;
  if (listed.ok) keys = listed.keys;
  else {
    unstable_rethrow(listed.error); // let a 401 redirect escape
    loadError = true;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 sm:px-8">
      <PageHeader
        title={m.developers.title}
        subtitle={m.developers.subtitle}
        action={
          <Link
            href="/admin/developers/docs"
            data-testid="api-docs-link"
            className={buttonVariants({ variant: 'soft' })}
          >
            <i aria-hidden className="pi pi-file-code" style={{ fontSize: 13 }} />
            {m.chrome.developersMenu.docs}
          </Link>
        }
      />
      <ApiKeysPanel
        initialKeys={keys}
        loadError={loadError}
        viewer={{ memberId: me.memberId, role: me.role, displayName: me.displayName, email: me.email }}
        m={m.developers.keys}
        locale={locale}
        timeZone={me.timezone ?? 'UTC'}
      />
    </div>
  );
}
