import { getMessages } from '@quill/shared';
import { getLocale } from '@/lib/locale';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Developers, API docs: every route an API key can call. A placeholder so the
 * rail's link lands somewhere; the reference itself replaces this body.
 */
export default async function DeveloperDocsPage() {
  const m = getMessages(await getLocale()).admin;
  return (
    <div className="mx-auto max-w-5xl px-6 py-10 sm:px-8">
      <PageHeader title={m.chrome.developersMenu.docs} />
    </div>
  );
}
