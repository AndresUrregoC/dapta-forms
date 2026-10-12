import { unstable_rethrow } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { adminApi, type ApiKey } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { PageHeader } from '@/components/ui/page-header';
import { ApiKeysPanel } from './api-keys';
import { DeveloperDocs } from './developer-docs';

export const dynamic = 'force-dynamic';

/**
 * Developers: where a person connects an AI agent (or their own code) to this
 * workspace. Two sections, owned by two different pieces of work: the API keys
 * (this page) and the docs (`developer-docs.tsx`, replaced as a unit).
 *
 * The keys come from `GET /v1/api-keys`, which already scopes them by role (a
 * member gets their own, an owner or admin all of the workspace's). A failed
 * read renders the error state rather than an empty list, so nobody is told
 * they have no keys when the truth is that nobody could check.
 */
export default async function DevelopersPage() {
  const locale = await getLocale();
  const m = getMessages(locale).admin;
  const me = await adminApi.me();

  let keys: ApiKey[] = [];
  let loadError = false;
  try {
    keys = (await adminApi.listApiKeys()).keys;
  } catch (e) {
    unstable_rethrow(e); // let a 401 redirect escape the catch
    loadError = true;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 sm:px-8">
      <PageHeader title={m.developers.title} subtitle={m.developers.subtitle} />
      <ApiKeysPanel
        initialKeys={keys}
        loadError={loadError}
        viewer={{ memberId: me.memberId, role: me.role, displayName: me.displayName, email: me.email }}
        m={m.developers.keys}
        locale={locale}
        timeZone={me.timezone ?? 'UTC'}
      />
      <DeveloperDocs locale={locale} />
    </div>
  );
}
