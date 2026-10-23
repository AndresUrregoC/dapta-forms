---
'@quill/db': patch
'@quill/mcp': patch
---

`notePersonLogins` stamps one person's active memberships in the accounts the identity service confirmed, `staffGrantsBySubject` reads the grants an MCP sign-in may reach, and `idpSubjectHeldByAnother` guards a looked-up subject. The MCP server never uses a workspace reached through a staff access grant without `workspace_id`, even when it is the only one.
