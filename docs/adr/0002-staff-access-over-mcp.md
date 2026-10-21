# Staff reach any workspace over MCP, the way they do in the web app

ADR 0001 said an MCP connection acts only in workspaces where the person has an active member, so the deployment's staff could not reach a customer's workspace over MCP although the web app's switcher lets them search and enter any workspace. We now give MCP connections the same staff rule: a person whose email, as the person directory holds it, is on one of the domains in `IAM_STAFF_DOMAINS` can search every workspace with `list_my_workspaces(search)` and act in any live one as an admin, through the same staff access grant (`member.access_grant = 'staff'`) the switcher mints. Because an MCP connection carries no session bearer to the identity service, the workspace is read from the identity service's database (read-only, the adapter that already maps a token to a person) instead of over its HTTP API. This supersedes 0001's consequence that a connection reaches only the person's own workspaces; everything else in 0001 holds.

## Consequences

- Staff is decided again on every request, never stored: grant rows are never revoked, so a person who stops being staff (email moved off the domains, or a domain dropped from the list) loses every workspace they reached through a grant on the next call, even with the row in place. The directory keeps who a person is for up to a minute, so an email change in the identity service is seen within that.
- The email comes from the identity service's user row, never from the request. It is as trustworthy as the identity service's guarantee that an address was verified and cannot be changed without verification. At the time of writing the token dForms receives carries no `email_verified` claim and dForms reads no verification column, so it cannot enforce "staff requires a verified email" itself; whoever runs the deployment confirms that guarantee before enabling `IAM_STAFF_DOMAINS` for MCP.
- Staff always pass `workspace_id`, even with one workspace of their own, and the agent is told everywhere (server instructions, `whoami`, `list_my_workspaces`, the guide) to confirm the workspace with the user before reading or writing, because a staff call can reach any customer's forms.
- A staff search never lists everything: it needs 3 letters or digits and returns at most 20. The identity service's search has no index, and this keeps it cheap.
- A staff call outside the person's own workspaces is visible: its result says `access: 'staff'`, its audit line says `via: 'staff_grant'`, and the API logs a line per call.
- API keys are unchanged: a key never becomes staff and never leaves its workspace. People who are not staff keep the uniform `NOT_FOUND` outside their workspaces.

## Considered options

- Keep staff out of MCP (0001): staff then need a member in every customer workspace, or an API key from each customer, to help them from an agent.
- Forward to the identity service's HTTP API as the web app does: an MCP connection has no session bearer to forward, and minting one would mean dForms holding a credential it does not need.
- Reuse grant rows without re-checking staff: grant rows outlive the person's staff status, so access would never be cut.
