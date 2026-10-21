---
'@quill/api': patch
---

The person directory of MCP connections reads the identity service's database.
With `MCP_OAUTH_PROVIDER` set, the API maps the person a token names to the
user id members carry: the live user row with that provider id, and only if
there is none, the live users its sessions link to it. More than one person,
or an inactive or blocked one, is refused with a 403 that says to contact
support; a deleted or unknown one is nobody. The settings are `IAM_DB_HOST`,
`IAM_DB_PORT` (5432 when unset), `IAM_DB_NAME`, `IAM_DB_SCHEMA`, `IAM_DB_USER`
and `IAM_DB_PASS`; all but the port are required with the provider set, or the
API refuses to boot. The connection uses TLS unless the host is a loopback
host, at most 4 connections and 5 seconds per query, and nothing connects
until the first sign-in. While the database cannot be read, a signed-in
request gets a 503 with `Retry-After` instead of a 500, and API keys keep
working.
