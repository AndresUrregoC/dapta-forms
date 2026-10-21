import { createHash } from 'node:crypto';
import { BackendError, type BackendIssue } from './backend';

/**
 * Shared plumbing for the tools: how a tool says "no" in words a model can act
 * on, how text typed by the public is cleaned before it reaches a model, and
 * how a call is described in the audit line without the data in it.
 */

/** A failure a model can act on. Rendered as an `isError` tool result. */
export class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ToolFailure';
  }

  /** The text the model reads: stable code first, then what to do about it. */
  render(): string {
    const retry = this.retryAfterSeconds ? ` Retry after ${this.retryAfterSeconds}s.` : '';
    return `${this.code}: ${this.message}${this.hint ? ` ${this.hint}` : ''}${retry}`;
  }
}

export const notFound = (what: string): ToolFailure =>
  new ToolFailure(
    'NOT_FOUND',
    `${what} not found in this workspace.`,
    'Check the id with list_forms. An id from another workspace is reported the same way.',
  );

// --- Untrusted text -------------------------------------------------------

/**
 * Zero-width and bidi-control characters: invisible to a person, and the usual
 * way to hide an instruction inside an answer.
 */
const INVISIBLE = new RegExp('[\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF\\u00AD]', 'g');
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]', 'g');

/** Drop every `<...>` span, in one pass. An unclosed `<` and what follows it stay as text. */
function stripTags(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('<', i);
    if (open === -1) break;
    const close = text.indexOf('>', open + 1);
    if (close === -1) break;
    out += text.slice(i, open);
    i = close + 1;
  }
  return out + text.slice(i);
}

/**
 * Markdown images vanish (an image URL is an exfiltration path) and links keep
 * their visible text only, in one pass with no backtracking: `![alt](url)` is
 * dropped, `[text](url)` becomes `text`. Brackets that are not a link stay.
 */
function stripMarkdownLinks(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('[', i);
    if (open === -1) break;
    const close = text.indexOf(']', open + 1);
    if (close === -1) break;
    if (text[close + 1] !== '(') {
      // No link ends at this `]`, and any `[` before it would end here too.
      out += text.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    const end = text.indexOf(')', close + 2);
    if (end === -1) break;
    const image = open > 0 && text[open - 1] === '!';
    out += text.slice(i, image ? open - 1 : open);
    if (!image) out += text.slice(open + 1, close);
    i = end + 1;
  }
  return out + text.slice(i);
}

/**
 * Tags and markdown stripped until nothing changes. One pass can uncover a
 * new image or link: in `[![x](a)](https://evil.example/p)` the inner image
 * goes and leaves `![x](https://evil.example/p)` behind. Every pass that
 * changes the text makes it shorter, so the loop ends.
 */
function stripMarkup(text: string): string {
  let previous: string;
  do {
    previous = text;
    text = stripMarkdownLinks(stripTags(text));
  } while (text !== previous);
  return text;
}

/**
 * Text written by a respondent (an answer, or a question with their answer
 * filled in). Cleaned and capped so it reads as data: control and invisible
 * characters go, HTML tags go, markdown images vanish (nested ones too), a
 * markdown link keeps its visible text, whitespace collapses, and the result
 * is length-capped. Cleaning a cleaned text changes nothing. Every pass is
 * linear, and the input is cut to `max * 4` characters before the passes
 * run, which also bounds how many passes there can be, so a hostile answer
 * cannot make this slow.
 */
export function untrusted(value: unknown, max = 500): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  text = text.slice(0, max * 4);
  text = stripMarkup(text.replace(INVISIBLE, '').replace(CONTROL, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}

// --- Audit ----------------------------------------------------------------

/** Argument names whose values never reach a log, even as part of a hash input shape. */
const REDACT_KEYS = new Set(['config', 'name', 'slug', 'from', 'to', 'query']);

/** The arguments with every content-bearing value replaced by a marker. */
export function redactArgs(value: unknown, key = ''): unknown {
  if (REDACT_KEYS.has(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => redactArgs(item, key));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, redactArgs(v, k)]),
    );
  return value;
}

/** Stable short digest of the redacted arguments: same call shape, same hash. */
export function argsHash(args: unknown): string {
  return createHash('sha256').update(JSON.stringify(redactArgs(args) ?? null)).digest('hex').slice(0, 16);
}

// --- Errors ---------------------------------------------------------------

/** What a log may say about an unexpected failure: its class and its code, nothing it carried. */
export interface ErrorDescriptor {
  /** The constructor name of an `Error`, else the `typeof` of what was thrown. */
  errorClass: string;
  /** A short machine code (`SQLITE_BUSY`, `ECONNREFUSED`, `23505`) when the error had one. */
  code?: string;
}

const SAFE_CLASS = /^[A-Za-z_$][\w$]{0,63}$/;
const SAFE_CODE = /^[\w.:-]{1,40}$/;

/**
 * An unexpected failure reduced to what is safe to log. The message and the
 * stack are dropped: a database or validation error can quote a config, an
 * answer or an address from the request that caused it.
 */
export function describeError(error: unknown): ErrorDescriptor {
  if (!(error instanceof Error)) return { errorClass: error === null ? 'null' : typeof error };
  const name = error.constructor?.name;
  const descriptor: ErrorDescriptor = { errorClass: name && SAFE_CLASS.test(name) ? name : 'Error' };
  const code = (error as { code?: unknown }).code;
  if ((typeof code === 'string' || typeof code === 'number') && SAFE_CODE.test(String(code))) descriptor.code = String(code);
  return descriptor;
}


/** What to do about each issue code the form validator reports. */
const ISSUE_HINTS: Record<string, string> = {
  UNSUPPORTED_FIELD:
    'Remove it, or send back exactly the value you read. Only the fields in the config_schema of get_form_guide are accepted.',
  EMPTY_QUESTION: 'Only message, reveal and scheduler steps may go without one.',
  STEPS_REQUIRED: 'Send the full steps array: the config replaces the whole draft.',
  invalid_type: 'Wrong type or missing value.',
  invalid_enum_value: 'Use one of the allowed values.',
  invalid_literal: 'Use the exact value shown (for example version must be 1).',
  invalid_union_discriminator: 'Unknown type: check the allowed values.',
  unrecognized_keys: 'Remove the unknown keys.',
  too_small: 'Too short, too few items or too low.',
  too_big: 'Too long, too many items or too high.',
};

/** Body paths the tools rename: the backend speaks the REST body, the model speaks tool arguments. */
const PATH_RENAMES: Record<string, string> = { folderId: 'folder_id', expectedUpdatedAt: 'expected_updated_at' };

function toolPath(path: string): string {
  if (!path) return '(arguments)';
  const [head, ...rest] = path.split('.');
  return [PATH_RENAMES[head!] ?? head, ...rest].join('.');
}

const MAX_LISTED_ISSUES = 25;

/** Every validation issue, one line each, path first, so a model can fix them all in one retry. */
export function renderIssues(issues: BackendIssue[]): string {
  const lines = issues.slice(0, MAX_LISTED_ISSUES).map((issue) => {
    const hint = ISSUE_HINTS[issue.code];
    return `- ${toolPath(issue.path)} [${issue.code}]: ${issue.message}${hint ? ` ${hint}` : ''}`;
  });
  if (issues.length > MAX_LISTED_ISSUES) lines.push(`- ...and ${issues.length - MAX_LISTED_ISSUES} more.`);
  return lines.join('\n');
}

/** Which kind of credential a call came with: the copy a model reads speaks of it. */
export type CredentialKind = 'key' | 'connection';

/**
 * What each backend code means for the model that triggered it. An entry in
 * `CONNECTION` replaces the one here for a person signed in through OAuth,
 * who has no key to replace and no key owner to blame.
 */
const ACTIONABLE: Record<string, { message?: string; hint: string }> = {
  STALE: {
    message: 'The form was saved elsewhere since you read it.',
    hint: 'Call get_form, apply your change again on the config it returns, and retry with its updated_at. Never drop the other edits.',
  },
  NOTHING_TO_REVERT: {
    message: 'This form has no earlier published version to bring back.',
    hint: 'previous_published_at is null on get_form when there is nothing to revert to.',
  },
  SLUG_TAKEN: { hint: 'Pick another slug: another form in this workspace holds it.' },
  SLUG_INVALID: { hint: 'Use lowercase letters, numbers and hyphens.' },
  FORBIDDEN: {
    hint: "The key's owner lacks the role for this. Tell the user; an owner or admin of the workspace can do it.",
  },
  KEY_NOT_ALLOWED: { hint: 'This can only be done in the dForms dashboard. Tell the user.' },
  MEMBER_NOT_ACTIVE: {
    hint: 'You were removed from this workspace, or your access there was turned off. Call list_my_workspaces to see where you can act, and tell the user.',
  },
  INVALID_API_KEY: {
    message: 'The API key stopped working: it was revoked, or its owner left the workspace.',
    hint: 'Ask the user for a new key (dForms, MCP, API keys).',
  },
};

const CONNECTION: Record<string, { message?: string; hint: string }> = {
  FORBIDDEN: {
    hint: 'You lack the role for this in this workspace. Tell the user; an owner or admin of the workspace can do it.',
  },
  INVALID_API_KEY: {
    message: 'This sign-in can no longer act here.',
    hint: 'Call list_my_workspaces to see where you can act. If the problem stays, ask the user to connect dForms again.',
  },
};

/** Map anything a tool can throw to a `ToolFailure` the model can act on, in the terms of the call's credential. */
export function toFailure(error: unknown, credential: CredentialKind = 'key'): ToolFailure {
  if (error instanceof ToolFailure) return error;
  if (error instanceof BackendError) {
    if (error.status === 400 && error.issues.length > 0) {
      const count = error.issues.length;
      return new ToolFailure(
        'VALIDATION_FAILED',
        `${count} problem${count === 1 ? '' : 's'} in the arguments. Fix every one, then retry the same call:\n${renderIssues(error.issues)}`,
        'The config schema, the step types and worked examples are in get_form_guide.',
      );
    }
    if (error.status === 404) return notFound('Form');
    if (error.status === 429) {
      const after = Number(error.details['retryAfterSec']);
      return new ToolFailure(
        'RATE_LIMITED',
        credential === 'connection' ? 'Too many calls by this member.' : 'Too many calls with this API key.',
        'Wait, then continue.',
        Number.isFinite(after) && after > 0 ? Math.ceil(after) : 5,
      );
    }
    if (error.status >= 500) return internalError();
    const known = (credential === 'connection' ? CONNECTION[error.code] : undefined) ?? ACTIONABLE[error.code];
    let message = known?.message ?? error.message;
    if (error.code === 'STALE' && typeof error.details['updatedAt'] === 'number')
      message = `${message} Its updated_at is now ${error.details['updatedAt']}.`;
    return new ToolFailure(error.code, message, known?.hint);
  }
  return internalError();
}

function internalError(): ToolFailure {
  return new ToolFailure(
    'INTERNAL_ERROR',
    'dForms failed to complete this call.',
    'Retry once. For create_form, call list_forms first: the form may already exist.',
  );
}
