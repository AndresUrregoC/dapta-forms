---
'@quill/api': patch
---

MCP sign-ins after the first day in production, still with no identity database:

- **Any active role connects** (owner, admin or member); each tool call applies the member's live role.
- **One visit to the web links every workspace** the identity service confirms on that visit, not only the one it opened.
- **Older sessions link without logging out**: when the session token carries no usable WorkOS id, the API reads it from the person's own user row in the identity service, with their own bearer (2 second limit), only while the member has no link yet, only from an active, not deleted row, and records it only if no member of anyone else carries it.
- **Staff reach a customer workspace for a day** after opening it on the web as staff (their staff access grant), only next to an active membership of their own, shown as `access: 'staff'`, never used without `workspace_id`, and audited as staff calls. No search over other workspaces from a sign-in.
- The refusal now says to open dForms with that account; its log reason `not_active_admin` becomes `no_active_membership`.
