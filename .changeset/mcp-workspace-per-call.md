---
'@quill/mcp': minor
'@quill/db': patch
---

An MCP connection can act in every workspace where the person signed in holds an active member, choosing one per call.

- `@quill/mcp`: the OAuth side's `authenticate` now resolves an `McpConnection` (the person, with one `McpCaller` per workspace they may act in) instead of a single caller, and `McpCaller` carries `workspaceName`. New tool `list_my_workspaces` (name, role and id). Every tool that acts in a workspace takes an optional `workspace_id`: an API key keeps its own workspace and refuses any other (`WORKSPACE_MISMATCH`); a connection with several workspaces must name one (`WORKSPACE_REQUIRED`, which points at `list_my_workspaces`), uses its only one without asking, and answers `NOT_FOUND` for any workspace it cannot act in. A connection with no workspace is let in, and its tools answer `NO_WORKSPACE` with what to do. Every result names the workspace it acted in (`workspace` in the structured content, and the text summary). `whoami` reports the person and every workspace, `get_form_guide` explains how to choose one, and the door counts a connection's requests per member of the workspace each call names. `FormsMcpServerOptions.appUrl` names the address a person opens to get a first workspace.
- `@quill/db`: `findApiKeyPrincipal` also returns the key's workspace name (`accountName`).
