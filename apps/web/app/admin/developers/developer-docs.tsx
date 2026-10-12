import type { ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { getLocale } from '@/lib/locale';
import { publicApiUrl } from '@/lib/developer-skill/public-api-url';
import { getDeveloperDocsMessages, type DeveloperDocsMessages } from './developer-docs-messages';

/** Where the skill zip is served; the route builds it for this environment. */
export const SKILL_DOWNLOAD_PATH = '/api/developers/skill';

/**
 * The "How to use the API" section of the Developers page: the API address of
 * this environment, how to authenticate, the create, edit, publish and revert
 * flow, the traps, and the skill download.
 *
 * A server component. The API address is read from the runtime environment on
 * every render (`publicApiUrl`), never from the build, so one image shows each
 * environment its own address. Nothing here is interactive: the download is a
 * plain link to a route that requires the session.
 */
export async function DeveloperDocs() {
  const locale = await getLocale();
  return <DeveloperDocsView m={getDeveloperDocsMessages(locale)} apiUrl={publicApiUrl()} />;
}

const FLOW = [
  { id: 'create', method: 'POST', path: '/v1/forms' },
  { id: 'edit', method: 'PUT', path: '/v1/forms/{id}' },
  { id: 'publish', method: 'POST', path: '/v1/forms/{id}/publish' },
  { id: 'revert', method: 'POST', path: '/v1/forms/{id}/revert' },
] as const;

const GOTCHAS = ['put', 'stale', 'destinations', 'rateLimit'] as const;

/** Render `text` with every backtick-quoted run as inline code. */
function rich(text: string): ReactNode[] {
  return text.split('`').map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="break-words rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

function CodeBlock({ children, testId }: { children: string; testId?: string }) {
  return (
    // The block scrolls inside itself, so a long URL never widens the page.
    <pre
      data-testid={testId}
      className="max-w-full overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-xs leading-relaxed text-foreground"
    >
      <code>{children}</code>
    </pre>
  );
}

export function DeveloperDocsView({ m, apiUrl }: { m: DeveloperDocsMessages; apiUrl: string | null }) {
  const base = apiUrl ?? 'https://api.example.com';
  const curl = `curl ${base}/v1/me \\\n  -H "Authorization: Bearer $DFORMS_API_KEY"`;

  return (
    <section
      data-testid="developer-docs"
      aria-labelledby="developer-docs-title"
      className="mt-10 flex min-w-0 flex-col gap-8 border-t border-border pt-8"
    >
      <div className="flex flex-col gap-1">
        <h2 id="developer-docs-title" className="text-lg font-semibold text-foreground">
          {m.title}
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{m.intro}</p>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">{m.apiUrlLabel}</h3>
          {apiUrl ? (
            <CodeBlock testId="developer-docs-api-url">{apiUrl}</CodeBlock>
          ) : (
            <p
              data-testid="developer-docs-api-url-missing"
              className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground"
            >
              {rich(m.apiUrlMissing)}
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">{m.authTitle}</h3>
          <p className="text-sm text-muted-foreground">{rich(m.authBody)}</p>
          <CodeBlock testId="developer-docs-auth">{curl}</CodeBlock>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">{m.flowTitle}</h3>
          <p className="text-sm text-muted-foreground">{m.flowBody}</p>
        </div>
        <ol className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {FLOW.map((step, i) => (
            <li
              key={step.id}
              data-testid={`developer-docs-flow-${step.id}`}
              className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4"
            >
              <span className="text-2xs font-medium uppercase tracking-wide text-faint">
                {i + 1}. {m.flowLabels[step.id]}
              </span>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-xs">
                <span className="font-semibold text-foreground">{step.method}</span>
                <span className="min-w-0 break-all text-muted-foreground">{step.path}</span>
              </span>
              <p className="text-sm text-muted-foreground">{rich(m.flow[step.id])}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">{m.gotchasTitle}</h3>
        <ul className="flex flex-col gap-2">
          {GOTCHAS.map((id) => (
            <li
              key={id}
              data-testid={`developer-docs-gotcha-${id}`}
              className="flex min-w-0 gap-3 text-sm text-muted-foreground"
            >
              <i aria-hidden className="pi pi-exclamation-circle mt-0.5 shrink-0 text-faint" style={{ fontSize: 14 }} />
              <span className="min-w-0">{rich(m.gotchas[id])}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">{m.skillTitle}</h3>
          <p className="max-w-2xl text-sm text-muted-foreground">{m.skillBody}</p>
          <p className="max-w-2xl text-xs text-faint">{m.skillContents}</p>
        </div>
        {apiUrl ? (
          <a
            href={SKILL_DOWNLOAD_PATH}
            download
            data-testid="developer-docs-download"
            className={buttonVariants({ className: 'shrink-0 self-start sm:self-center' })}
          >
            <i aria-hidden className="pi pi-download" style={{ fontSize: 14 }} />
            {m.skillButton}
          </a>
        ) : (
          <p className="shrink-0 text-sm text-muted-foreground">{m.skillUnavailable}</p>
        )}
      </div>
    </section>
  );
}
