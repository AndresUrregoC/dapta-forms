# dForms

Self-hostable forms platform: people build forms in the admin, respondents answer them, and agents operate them through the API and the MCP server.

## Language

### Who

**Workspace**:
The unit that owns forms, responses, brand kit and integrations. Every request acts inside exactly one workspace.
_Avoid_: Account, organization, tenant

**Member**:
A person's place in one workspace, with one role. A person can be a member of several workspaces.
_Avoid_: User, seat

**Role**:
What a member may do in a workspace: owner, admin or member. Checked on every request, never cached in a credential.
_Avoid_: Permission level

**Respondent**:
Someone who answers a published form. Never a member by virtue of answering.
_Avoid_: User, lead, contact

### How agents get in

**API key**:
A secret a member creates for one workspace; it acts as that member, with the member's current role, in that workspace only.
_Avoid_: Token, PAT

**MCP connection**:
An agent client (a chat app or a coding agent) signed in to the MCP server as a person through OAuth. Unlike an API key it is not tied to one workspace: each call names the workspace it acts in.
_Avoid_: OAuth key, integration

**Identity provider**:
The login service that signs an MCP connection's token. dForms only verifies its tokens; it never sees a password.
_Avoid_: Auth server, SSO
