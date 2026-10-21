---
'@quill/config': minor
'@quill/mcp': minor
---

The MCP door can take MCP connections signed in through OAuth next to API keys.

- `@quill/mcp`: `McpDoorOptions.oauth`, the door's OAuth side. A bearer it
  recognizes as an API key takes the key path, unchanged; any other goes to
  its `authenticate`. A request without a credential, or with a token that
  does not verify, gets a 401 whose `WWW-Authenticate` carries
  `resource_metadata` (RFC 9728), so a client can find the login; a dead API
  key never does. `DoorRefusal` turns a verified credential that cannot act
  into a 403 with its message. `McpCaller.personId` names the person a
  connection signed in as; the audit line carries it, and `whoami` answers
  `key: null` for a connection. The `challenge` option is gone. Without
  `oauth`, the door behaves exactly as before.
- `@quill/config`: `MCP_OAUTH_PROVIDER` (unset, or `workos`),
  `WORKOS_AUTHKIT_DOMAIN` and `MCP_PUBLIC_URL`, and `mcpOAuth`, the resolved
  settings (null when off). With a provider set, a missing or malformed value,
  or an `MCP_ALLOWED_HOSTS` that leaves out the public URL's host, refuses to
  boot.
