---
'@quill/mcp': patch
---

A tool result's `workspace.id` is now the `workspace_id` the agent sent. A staff search can return the identity service's id for a workspace, which differs from the dForms id, and an agent that compared the two thought its call had landed in another workspace.
