'use client';

import type { FormsMessages } from '@quill/shared';
import { McpAppLogo, type McpLogo } from '@/components/mcp-logos';
import { CodePanel, type CopyLabels } from './docs/code-panel';
import { Step } from './setup-guide';

type GuideMessages = FormsMessages['admin']['developers']['guide'];
type ChatApp = GuideMessages['chat']['claude'];

/**
 * The chat path of the MCP page: connect Claude.ai or ChatGPT with the URL
 * alone and a sign-in, no key. Rendered only when this deployment's MCP takes
 * a sign-in (`mcpOauthEnabled`); the key guide for terminal agents follows it.
 *
 * Three steps, like the key guide next to it: copy the URL, add it as a
 * connector (both chat apps side by side, so nobody has to pick one to read
 * the steps), ask it for something. `url` is this environment's MCP address,
 * read on the server; null when the deployment has none, and then the step
 * says so instead of printing an address nobody can reach.
 *
 * Nothing here shows as done: a sign-in leaves no trace the page can read.
 */
export function ChatGuide({ m, copy, url }: { m: GuideMessages; copy: CopyLabels; url: string | null }) {
  const c = m.chat;
  return (
    <section
      aria-labelledby="chat-guide-title"
      data-testid="mcp-path-chat"
      className="mb-6 rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <h2 id="chat-guide-title" className="text-lg font-semibold text-foreground">
        {c.title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{c.intro}</p>

      <ol className="mt-6 flex flex-col">
        <Step n={1} title={c.urlTitle} done={false} doneLabel={m.stepDone} testId="chat-step-url">
          {url === null ? (
            <p data-testid="mcp-chat-unavailable" className="text-sm text-muted-foreground">
              {m.mcpUnavailable}
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">{c.urlBody}</p>
              <CodePanel
                label={c.urlLabel}
                code={url}
                language="text"
                copyLabel={c.copyUrl}
                m={copy}
                wrap
                testId="mcp-chat-url"
              />
            </>
          )}
        </Step>

        <Step n={2} title={c.addTitle} done={false} doneLabel={m.stepDone} testId="chat-step-add">
          <p className="mb-3 text-sm text-muted-foreground">{c.addBody}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <ChatAppSteps app={c.claude} logo="claude" testId="chat-app-claude" />
            <ChatAppSteps app={c.chatgpt} logo="openai" testId="chat-app-chatgpt" />
          </div>
        </Step>

        <Step n={3} title={c.tryTitle} done={false} doneLabel={m.stepDone} last testId="chat-step-try">
          <p className="mb-2 text-sm text-muted-foreground">{m.promptHint}</p>
          <CodePanel
            label={`${c.claude.name}, ${c.chatgpt.name}`}
            code={c.prompt}
            language="text"
            copyLabel={m.copyPrompt}
            m={copy}
            wrap
            testId="chat-prompt"
          />
          <p className="mt-4 flex gap-2 text-xs text-muted-foreground" data-testid="chat-workspaces-note">
            <i aria-hidden className="pi pi-info-circle mt-px shrink-0" style={{ fontSize: 12 }} />
            <span>{c.workspacesNote}</span>
          </p>
        </Step>
      </ol>
    </section>
  );
}

/** One chat app: its logo and name, then its connector steps in order. */
function ChatAppSteps({ app, logo, testId }: { app: ChatApp; logo: McpLogo; testId: string }) {
  return (
    <div data-testid={testId} className="min-w-0 rounded-lg border border-border bg-panel p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <McpAppLogo logo={logo} size={16} />
        {app.name}
      </h4>
      <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm text-muted-foreground marker:text-faint">
        {app.steps.map((step) => (
          <li key={step} className="pl-1">
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}
