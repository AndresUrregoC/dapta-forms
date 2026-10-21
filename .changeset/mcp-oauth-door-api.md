---
'@quill/api': patch
---

`/mcp` accepts MCP connections signed in through OAuth when
`MCP_OAUTH_PROVIDER=workos`. The API verifies the AuthKit access token (RS256
against the issuer's published keys, `iss` and `aud` exact, `sub` and `exp`
required), maps its subject to a person through the person directory, and acts
as that person's only active member with the in-process principal, so every
tool call re-reads the member and its live role. `GET
/.well-known/oauth-protected-resource/mcp` publishes the protected-resource
metadata. The MCP buckets count per member, and the audit line names member,
person and workspace, never the token. A person with no active member, or with
more than one, is refused with a 403 that says what to do. With the provider
unset, nothing changes. A provider set without a person directory adapter
refuses to boot.
