import { isConnection, type McpCaller, type McpCredential } from './backend';
import { ToolFailure } from './support';

/**
 * Which workspace a tool call acts in.
 *
 * An API key has one workspace and keeps it: a call may leave `workspace_id`
 * out or name the key's own, and any other is refused, so a key never leaves
 * its workspace. An MCP connection names a person who may hold members in
 * several workspaces: a call names one with `workspace_id`, and with exactly
 * one workspace it may leave it out. The choice is always among the person's
 * active members as the host read them on this request, so an id of any other
 * workspace (one they never joined, one they were removed from, one they
 * reach only by a staff access grant) is reported exactly like an id that
 * does not exist.
 */

export const LIST_WORKSPACES_HINT =
  'Call list_my_workspaces, ask the user which workspace by its name (never pick one yourself), then repeat this call with that workspace_id.';

/** The message for a person with no workspace yet. `appUrl` is the dForms address they open, when the host knows it. */
export function noWorkspace(appUrl?: string): ToolFailure {
  return new ToolFailure(
    'NO_WORKSPACE',
    'You are not an active member of any dForms workspace yet.',
    `Ask the user to open dForms once with this account${appUrl ? ` (${appUrl})` : ''}, then try again.`,
  );
}

/**
 * The caller a tool call acts as, or a `ToolFailure` the model can act on.
 * `required` false (whoami): null instead of a failure when the call does not
 * name a workspace and there is not exactly one to use.
 */
export function resolveWorkspace(
  credential: McpCredential,
  workspaceId: string | undefined,
  opts: { required: boolean; appUrl?: string },
): McpCaller | null {
  if (!isConnection(credential)) {
    if (workspaceId !== undefined && workspaceId !== credential.accountId) {
      throw new ToolFailure(
        'WORKSPACE_MISMATCH',
        'This API key belongs to one workspace and cannot act in another.',
        'Leave workspace_id out (the key always uses its own workspace), or ask the user for an API key of the other workspace.',
      );
    }
    return credential;
  }
  const { workspaces } = credential;
  if (workspaceId !== undefined) {
    const named = workspaces.find((w) => w.accountId === workspaceId);
    if (named) return named;
    throw new ToolFailure(
      'NOT_FOUND',
      'No workspace of yours has this id.',
      'Use an id from list_my_workspaces: you may have been removed from that workspace.',
    );
  }
  if (workspaces.length === 1) return workspaces[0]!;
  if (!opts.required) return null;
  if (workspaces.length === 0) throw noWorkspace(opts.appUrl);
  throw new ToolFailure(
    'WORKSPACE_REQUIRED',
    `You are a member of ${workspaces.length} dForms workspaces, so this call must name one in workspace_id.`,
    LIST_WORKSPACES_HINT,
  );
}

/**
 * The rate-limit bucket of one request at the door. An API key: the key. An
 * MCP connection: the member of the workspace the call acts in (the one a
 * `tools/call` names, or the only one), so one person's clients share a
 * budget per workspace; a request that acts in no workspace (initialize,
 * tools/list, a call that names none) counts against the person.
 */
export function bucketOf(credential: McpCredential, body: unknown): string {
  if (!isConnection(credential)) return credential.credentialId;
  const named = workspaceIdOf(body);
  const caller =
    named !== undefined
      ? credential.workspaces.find((w) => w.accountId === named)
      : credential.workspaces.length === 1
        ? credential.workspaces[0]
        : undefined;
  return caller ? caller.credentialId : `person:${credential.personId}`;
}

/** The `workspace_id` argument of a `tools/call` body, when it has a string one. */
function workspaceIdOf(body: unknown): string | undefined {
  const rpc = body as { method?: unknown; params?: { arguments?: { workspace_id?: unknown } } } | undefined;
  if (rpc?.method !== 'tools/call') return undefined;
  const id = rpc.params?.arguments?.workspace_id;
  return typeof id === 'string' ? id : undefined;
}
