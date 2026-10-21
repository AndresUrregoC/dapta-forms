---
'@quill/api': patch
---

An MCP connection signed in through OAuth reaches every workspace where the person has an active member, instead of being refused with more than one. The API lists those workspaces again on every request from dForms' own members (never from the identity provider, and never a staff access grant or a pending invitation), so removing or disabling a member takes that workspace away on the next call. A person with no workspace yet now connects, and the tools tell their agent to open dForms once; a sign-in the person directory does not know is still refused with a 403. The MCP buckets count per member of the workspace each call acts in.
