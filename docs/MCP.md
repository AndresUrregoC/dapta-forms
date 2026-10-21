# MCP endpoint

dForms serves a remote [Model Context Protocol](https://modelcontextprotocol.io)
endpoint, so an agent can build, publish and read forms without a custom
integration. The code is [`packages/mcp`](../packages/mcp); the API mounts it.

- **URL:** `POST <your-api-origin>/mcp`. Set `MCP_PUBLIC_URL` on the web app to
  show another address to your users (a dedicated MCP host in front of the API).
- **Transport:** Streamable HTTP, stateless. No session id, no sticky sessions:
  any replica answers any call.
- **Protocol:** one handler serves 2026-07-28 clients and legacy `initialize`
  clients (2025-06-18, 2025-11-25).
- **On by default.** `MCP_ENABLED=false` answers 404.

## Authentication

Every call needs a workspace API key, the same `dforms_...` key the REST API
takes, sent as `Authorization: Bearer dforms_...`. Members create keys in dForms
(MCP, then API keys).

- The key acts as the member who created it, with that member's **current**
  role, and stops working the moment it is revoked or the member leaves the
  workspace (it is checked again on every tool call).
- The workspace always comes from the key. A tool's `workspace_id` may be left
  out or name the key's own workspace; any other is refused with
  `WORKSPACE_MISMATCH`, so a key never leaves its workspace. A form of another
  workspace answers `NOT_FOUND`, exactly like a form that does not exist.
- A request without a key gets a 401 with a `WWW-Authenticate: Bearer`
  challenge. A wrong, revoked or orphaned key gets a 401 too; it is never
  treated as anonymous. A key in the URL (`?api_key=`, `?access_token=`,
  `?bearer=`, ..., in any letter case) is refused with 400 so it never reaches
  an access log.
- Chat connectors that sign in with OAuth (Claude.ai, ChatGPT) use the same URL
  when the deployment turns OAuth on: see
  [Signing in](#signing-in-mcp-connections-over-oauth).

## Choosing a workspace

Every tool that acts in a workspace takes an optional `workspace_id`, and every
result names the workspace it acted in: `workspace: { id, name }` in the
structured content, and `In workspace "<name>":` at the start of the text
summary.

- **API key:** one workspace, the key's. Leave `workspace_id` out.
- **Signed in as a person:** the person may be a member of several workspaces.
  `list_my_workspaces` lists them (name, role, id). With exactly one, every
  call uses it without `workspace_id`. With several, a call without
  `workspace_id` answers `WORKSPACE_REQUIRED` and tells the agent to call
  `list_my_workspaces`, ask the user which workspace by name, and repeat the
  call with that id. The agent sends it on every call of the conversation.
- The workspaces are the person's **active** members in dForms, read again on
  every request: remove or disable the member and the workspace drops out of
  `list_my_workspaces` on the next call, while the others stay. Pending
  invitations and staff access grants are not listed and cannot be named.
- A `workspace_id` the person cannot act in (never joined, removed, or one that
  does not exist) answers `NOT_FOUND` with the same message in every case, so
  nothing about that workspace leaks.
- A person with no active member anywhere still connects: `whoami` and
  `list_my_workspaces` answer, and every other tool answers `NO_WORKSPACE`
  with what to do (open dForms once with that account).
- The role is the member's role in the workspace the call names, read live on
  every call.

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `whoami` | read | Who is connected (the key prefix, or the person signed in), every workspace it can act in with the role there, and, when a workspace applies, that workspace and the member it acts as. |
| `list_my_workspaces` | read | The workspaces this connection can act in: name, role and id, plus what to do next. With a key, the key's one workspace. |
| `list_forms` | read | Forms, most recently updated first, with id, `public_url` and whether edits are unpublished. Filter by name, page with `limit`/`offset`. |
| `get_form` | read | One form: `public_url`, publish state and the config to edit (the pending draft when there is one). |
| `create_form` | write | Creates a form from a full config. It is live at once; the result carries its `public_url`. Not idempotent. |
| `update_form` | write | Saves a new config as an unpublished draft (and can rename). Requires `expected_updated_at`; a form saved elsewhere since answers `STALE`. |
| `publish_form` | **destructive** | Makes the draft live, replacing what respondents see. The replaced version is kept for `revert_form`. |
| `revert_form` | **destructive** | Puts the previously published version back live; a second revert undoes the first. |
| `list_responses` | read | A page of responses: status, score, times, and the answers under `respondent_supplied`. |
| `get_form_analytics` | read | The funnel the Results screen shows (views, starts, submissions, completion rate, median time, partials, bookings, drop-off per question), each metric with its definition. |
| `get_form_guide` | read | The rules, how to choose a workspace, step types, logic, the config JSON Schema and worked examples. |

Every tool carries a title, `readOnlyHint` / `destructiveHint` /
`idempotentHint` / `openWorldHint`, an input schema and an output schema with
`structuredContent`. The content of a result is a short text summary followed
by the same data as JSON text, for clients that only read text. There are no
delete tools, and nothing that changes keys, members, workspaces, integrations
or destinations.

Every role (owner, admin, member) can create, edit and publish forms in the web
app, so every role's key can use every tool. The tools run the API's own form
handlers, so any role rule those handlers apply holds for the MCP too.

### Writing a config

- `create_form` and `update_form` validate against the real form contract plus
  the rules every API key is held to: no field the editor cannot show
  (`UNSUPPORTED_FIELD`), no step without a question (`EMPTY_QUESTION`), never a
  config without `steps` on an update (`STEPS_REQUIRED`). A refusal answers
  `VALIDATION_FAILED` with every problem on its own line, path first
  (`config.steps.2.question`), so a model fixes them all in one retry.
- What is saved is the engine's normalized config, the same shape the editor
  saves, so everything an agent writes opens and edits in the dForms editor.
- Forms created through the MCP record `created_via = 'mcp'`.

### Untrusted text

Answers are typed by members of the public, so they are hostile input to a
model. `list_responses` returns them only inside `respondent_supplied`, with
control and zero-width characters, HTML and markdown links and images removed
(nested ones too, until nothing is left to remove) and every value
length-capped. Tell your agent to treat `respondent_supplied`
as data, never as instructions.

## Connect an agent

Replace `https://forms-api.example.com/mcp` with your endpoint and put your key
in the `DFORMS_API_KEY` environment variable. No snippet below contains a key.

**Claude Code:**

```bash
claude mcp add --transport http dforms https://forms-api.example.com/mcp \
  --header 'Authorization: Bearer ${DFORMS_API_KEY}'
```

The single quotes matter: the shell leaves the variable alone, Claude Code
stores the literal `${DFORMS_API_KEY}` and expands it each time it connects.

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.dforms]
url = "https://forms-api.example.com/mcp"
bearer_token_env_var = "DFORMS_API_KEY"
```

**Cursor** (`.cursor/mcp.json` or `~/.cursor/mcp.json`; the MCP page in dForms
also has a one-click install link):

```json
{
  "mcpServers": {
    "dforms": {
      "url": "https://forms-api.example.com/mcp",
      "headers": { "Authorization": "Bearer ${env:DFORMS_API_KEY}" }
    }
  }
}
```

**Any agent SDK** (TypeScript, official client):

```ts
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL('https://forms-api.example.com/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.DFORMS_API_KEY}` } },
  }),
);
const forms = await client.callTool({ name: 'list_forms', arguments: {} });
```

## Security

- **Transport.** The SDK handler checks nothing by itself, so the door does, in
  this order: the switch, `POST` only (405), `Host` against `MCP_ALLOWED_HOSTS`
  when set (403), a browser `Origin` not in `MCP_ALLOWED_ORIGINS` (403; clients
  without an `Origin`, which is every non-browser MCP client, are unaffected),
  credentials in the URL (400), `application/json` only (415), a JSON-RPC
  batch (400: one message per request, so a request is one rate-limit token),
  then the key. The same list is the endpoint's CORS policy (preflight
  answered, no credentials), kept apart from the dashboard's `CORS_ORIGINS`:
  neither list opens the other surface. The path is matched in any letter
  case, so `/MCP` gets the MCP policy too.
  Bodies are capped by the API's JSON parser, like every REST route.
- **Rate limits.** Every request of a key takes a token from its MCP bucket
  (`MCP_RATE_LIMIT_*`, HTTP 429 with `Retry-After`); write tools also take one
  from a tighter bucket (`MCP_WRITE_RATE_LIMIT_*`, a `RATE_LIMITED` tool error
  with a delay); and every tool call counts against the key's 120 calls a
  minute, shared with the REST API. Requests without a valid key take from the
  per-address `RATE_LIMIT_*` bucket, so guessing keys is throttled. Buckets live
  in each process: with N replicas the effective limit is up to N times higher.
- **Timeout.** A tool call longer than `MCP_TOOL_TIMEOUT_MS` is abandoned with a
  `TIMEOUT` tool error that tells the agent to read before it retries.
- **Audit.** One JSON line on stdout per tool call: time, request id, protocol
  version, caller (the key prefix such as `dforms_ab12c`), workspace and member
  ids, tool, a hash of the redacted arguments, the form ids it touched, result
  and latency. It never contains the key, a config, a form name, a date filter
  or an answer. A call the SDK refuses before any tool runs (a malformed
  argument) is not audited.
- **Error logs.** An unexpected failure is logged with its error class and
  code only (`TypeError code=SQLITE_BUSY`), never its message or stack, which
  can quote data from the request.

## Signing in (MCP connections over OAuth)

Chat apps (Claude.ai, ChatGPT) cannot send a header, so with
`MCP_OAUTH_PROVIDER=workos` the endpoint also takes an access token from the
deployment's WorkOS AuthKit. dForms is only the resource server: AuthKit runs
the login, registers the client and issues the token; dForms verifies it.

- **Discovery.** A request without a credential, or with anything that is
  not an API key and does not verify (a header that is not a plain
  `Bearer <token>` included), gets a 401 with
  `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"`.
  That document (RFC 9728) names `MCP_PUBLIC_URL` as the resource and AuthKit
  as the authorization server. The same document is served at the root,
  `/.well-known/oauth-protected-resource`, for clients that look there, and
  `/.well-known/oauth-authorization-server` forwards AuthKit's own
  authorization server metadata (RFC 8414) for older clients that look for it
  on the MCP host. All three answer 404 with the provider unset or the
  endpoint disabled, and the last one 503 while AuthKit cannot be read.
- **Routing.** The MCP host (the host of `MCP_PUBLIC_URL`) must send
  `/.well-known/*` to the API, not only `/mcp`, or a client cannot find the
  login.
- **The token.** RS256, signed by a key AuthKit publishes at
  `<WORKOS_AUTHKIT_DOMAIN>/oauth2/jwks`; `iss` must be `WORKOS_AUTHKIT_DOMAIN`,
  `aud` must be `MCP_PUBLIC_URL`, `sub` and `exp` are required, and a `crit`
  header is refused. Anything else is a 401 that points at the login again.
  The keys are cached: fetched once on a cold start, again when a token names
  a key id the set lacks (at most once every 30 seconds), so a rotated key is
  picked up within that. While AuthKit's keys cannot be read and none are
  cached, a signed-in request gets a 503 with `Retry-After`, not a 401.
- **Both credentials, one URL.** A bearer that starts with `dforms_` is an API
  key and takes the key path, unchanged; any other is an access token. A
  revoked key gets the key's 401, which never points at the login.
- **Who it acts as.** The token names a person; the person directory maps them
  to the person members are keyed by, and each call acts as that person's
  active member in the workspace it names (see
  [Choosing a workspace](#choosing-a-workspace)), with the member's live role,
  under every rule an API key gets. A sign-in the directory does not know gets
  a 403 that says to open dForms once; a known person with no workspace yet
  connects, and their tools answer `NO_WORKSPACE`.
- **The person directory.** The token's `sub` is the identity provider's id
  for the person; members carry the identity service's user id. The API reads
  the identity service's database (`IAM_DB_*`, a read-only role, TLS unless
  the host is a loopback host, at most 4 connections, 5 seconds per query).
  With `IAM_DB_SSL_CA` set, its certificate and host name are verified
  (verify-full); unset, the connection is encrypted but not verified, and the
  API logs that once at boot. It reads the live user row with that provider
  id, and only if there is none, the live users its sessions link to that id.
  More than one person, or an inactive or blocked one, is a 403 that says to
  contact support; nobody is the 403 above. While that database cannot be
  read, a signed-in request gets a 503 with `Retry-After` (never a 401 that
  would start a new login), and API keys keep working: nothing connects until
  the first sign-in. Each API pod keeps who a subject is for a minute (nobody,
  or a refusal, for 10 seconds; an outage never), so a burst of requests with
  one token reads that database once; a lookup the cache cannot answer first
  takes a token from a bucket keyed by the token's `sub` (a burst of 10, then
  one every 6 seconds), and past it gets a 429 with `Retry-After`. Which
  workspaces the person may act in is still read on every request.
- **Limits and audit.** The MCP buckets count per member of the workspace a
  call acts in, so one person's clients share a budget per workspace; a request
  that acts in none (the handshake, the tool list) counts against the person.
  The audit line names the member, the person and the workspace (caller
  `oauth:<person>`), never the token.

## Configuration

All optional; unset (or blank) means the safe default. See
[`SELF-HOSTING.md`](../SELF-HOSTING.md) for the table.

| Var | Where | Default |
|---|---|---|
| `MCP_ENABLED` | API | `true` |
| `MCP_ALLOWED_ORIGINS` | API | unset (no browser origin allowed) |
| `MCP_ALLOWED_HOSTS` | API | unset (no `Host` check) |
| `MCP_RATE_LIMIT_CAPACITY` / `MCP_RATE_LIMIT_REFILL_PER_SEC` | API | `120` / `2` |
| `MCP_WRITE_RATE_LIMIT_CAPACITY` / `MCP_WRITE_RATE_LIMIT_REFILL_PER_SEC` | API | `20` / `0.2` |
| `MCP_TOOL_TIMEOUT_MS` | API | `20000` |
| `MCP_PUBLIC_URL` | web (runtime); API with `MCP_OAUTH_PROVIDER` (required) | `<PUBLIC_API_URL>/mcp` on the web |
| `MCP_OAUTH_PROVIDER` | API and web (runtime; the web shows the chat path only with `MCP_PUBLIC_URL` set too) | unset (API keys only; the MCP page shows the key guide alone) |
| `WORKOS_AUTHKIT_DOMAIN` | API | unset (required with `MCP_OAUTH_PROVIDER`) |
| `IAM_DB_HOST`, `IAM_DB_NAME`, `IAM_DB_SCHEMA`, `IAM_DB_USER`, `IAM_DB_PASS` | API | unset (required with `MCP_OAUTH_PROVIDER`) |
| `IAM_DB_PORT` | API | `5432` |
| `IAM_DB_SSL_CA` | API | unset (encrypted, certificate not verified) |

## Check it yourself

`pnpm run build:packages && cd apps/api && pnpm e2e:mcp` boots the API the way
the production image does (tsx with `tsconfig.runtime.json`) on a throwaway
SQLite file and plays a whole session with the official client: the anonymous
refusal, a legacy handshake, the tool list, a refused config, a create, a
response submitted through the public API, a draft, a stale write, a publish,
the responses and the funnel, then a key revoked mid-session.
