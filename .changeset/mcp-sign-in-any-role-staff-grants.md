---
'@quill/api': patch
---

MCP sign-ins after the first day in production, still with no identity database:

- **Any active role connects** (owner, admin or member); each tool call applies the member's live role.
- **One visit to the web links every workspace** the identity service confirms on that visit, not only the one it opened.
- **Older sessions link without logging out**: when the session token carries no usable WorkOS id, the API reads it from the person's own user row in the identity service, with their own bearer, only while the member has no link yet, and only from an active, unblocked row.
- **Staff reach the workspaces they entered as staff for a day** after their last web visit as staff (their staff access grants), shown as `access: 'staff'` and audited as staff calls. No search over other workspaces from a sign-in.
- The refusal now says to open dForms with that account; its log reason `not_active_admin` becomes `no_active_membership`.
