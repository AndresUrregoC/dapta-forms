---
'@quill/api': patch
---

The MCP tools now hand the app's handlers an in-process principal (the member and workspace a call acts as) instead of the caller's API key in a request header, so the key no longer travels with each in-process request: only its hash does, and the key path resolves it on every call exactly as before (revoked key or inactive member: 401, the per-key limit, last use, `created_via = 'mcp'`). Nothing that arrives over HTTP can carry one. The same principal can also name a member with no key, for MCP connections signed in through OAuth: the member is re-read on every call (disabled or removed: 401 `MEMBER_NOT_ACTIVE`), its role is the live one, and it gets every rule an API key gets (the route allowlist, the strict validation, no key management). Nothing produces that kind yet. For API-key callers nothing changes.
