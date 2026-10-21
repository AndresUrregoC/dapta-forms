import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { adminApi, type ApiKey } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { publicApiUrl } from '@/lib/developer-skill/public-api-url';
import { mcpOauthEnabled, mcpSnippets, publicMcpUrl } from '@/lib/developer-skill/mcp-connect';
import { PageHeader } from '@/components/ui/page-header';
import { buttonVariants } from '@/components/ui/button';
import { ApiKeysPanel } from '../api-keys';
import { SKILL_DOWNLOAD_PATH } from '../docs/docs-model';

export const dynamic = 'force-dynamic';

/**
 * MCP, API keys: a three-step guide (create a key, connect the agent to the
 * dForms MCP server, try it) above the workspace's keys. When this deployment's
 * MCP also takes a sign-in (`MCP_OAUTH_PROVIDER`, see `mcpOauthEnabled`), a
 * chat path comes first (Claude.ai and ChatGPT: paste the URL, sign in, no key)
 * and the key guide becomes the path for terminal agents. The MCP address is
 * read from the server's runtime environment on every request (`publicMcpUrl`),
 * never from a build-time variable, and every snippet names the key's
 * environment variable, never a key. The skill zip, the same as on the API
 * docs page, stays as the way in for an agent without MCP. What a key can call
 * lives on the docs page next door (`/admin/developers/docs`), linked from the
 * header.
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

  const mcpUrl = publicMcpUrl();
  // Runtime, like the address: one image serves every environment, and only
  // some of them have the sign-in switched on.
  const oauth = mcpOauthEnabled();

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
        subtitle={oauth ? m.developers.subtitleOauth : m.developers.subtitle}
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
        viewer={{
          memberId: me.memberId,
          role: me.role,
          displayName: me.displayName,
          email: me.email,
          accessGrant: me.accessGrant,
        }}
        m={m.developers.keys}
        locale={locale}
        timeZone={me.timezone ?? 'UTC'}
        guide={{
          m: m.developers.guide,
          mcp: mcpUrl ? mcpSnippets(mcpUrl) : null,
          // On only with MCP_PUBLIC_URL set, so the address is the API's token audience.
          chat: oauth && mcpUrl ? { url: mcpUrl } : null,
          skill: {
            // Read at request time like the docs page does: the route answers 503
            // without a public API address, so the button would only fail.
            available: publicApiUrl() !== null,
            href: SKILL_DOWNLOAD_PATH,
            button: m.developerDocs.skillButton,
            unavailable: m.developerDocs.skillUnavailable,
          },
        }}
      />
    </div>
  );
}
