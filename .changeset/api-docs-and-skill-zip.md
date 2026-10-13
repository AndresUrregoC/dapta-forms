---
'@quill/web': minor
---

The Developers page explains how to use the API, and hands out a skill for AI agents.

The "How to use the API" section shows this environment's API address, how to authenticate with `Authorization: Bearer`, the create, edit, publish and revert flow, and the traps: `PUT` replaces the whole config, `expectedUpdatedAt` guards against overwriting the editor, destinations have their own route, and a `429` carries `Retry-After`. English and Spanish.

"Download the skill" serves a zip from `GET /api/developers/skill`, signed-in members only (401 otherwise). It is built at request time with the environment's API and dashboard addresses, and holds `SKILL.md`, the endpoint and error references, the form config JSON Schema (generated from `formConfigSchema`, without the fields the editor has no control for) and recipes, plus how to install it in Claude Code, Codex and Cursor.

New runtime variable `PUBLIC_API_URL`: the API address customers can reach. Set it when `API_URL` names an internal address; the docs and the zip never show an internal one.
