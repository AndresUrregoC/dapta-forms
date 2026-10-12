import { getMessages, type Locale } from '@quill/shared';

/**
 * The docs section of the Developers page: how to use the API, plus the skill
 * to hand to an agent. A placeholder for now. The ticket that writes the guide
 * and the zip replaces THIS FILE ONLY, so the page around it never changes
 * shape: it renders `<DeveloperDocs locale={locale} />` and nothing else.
 */
export function DeveloperDocs({ locale }: { locale: Locale }) {
  const m = getMessages(locale).admin.developerDocs;
  return (
    <section aria-labelledby="developer-docs-title" data-testid="developer-docs">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 id="developer-docs-title" className="text-lg font-semibold text-foreground">
          {m.title}
        </h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {m.comingSoon}
        </span>
      </div>
      <p className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
        {m.body}
      </p>
    </section>
  );
}
