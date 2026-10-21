---
'@quill/config': minor
'@quill/mcp': minor
---

- `@quill/mcp`: `DoorUnavailable`, for a credential the door cannot check right
  now because something it depends on is down. The door answers it 503 with
  its message and `Retry-After: 30`, never a 401 that would send the client
  into a new login, and charges it to the client address like a refusal.
- `@quill/config`: `IAM_DB_HOST`, `IAM_DB_PORT`, `IAM_DB_NAME`,
  `IAM_DB_SCHEMA`, `IAM_DB_USER` and `IAM_DB_PASS`, the read-only access to
  the identity database that the API's person directory uses with
  `MCP_OAUTH_PROVIDER` set.
