/**
 * Several workspaces per MCP connection, end to end over HTTP: the whole API
 * on SQLite, a stand-in identity provider, a table as the person directory.
 *
 * A person signed in through OAuth may act in every workspace where they hold
 * an active member. Each call names its workspace (`workspace_id`), from
 * `list_my_workspaces`; with only one, it is used without asking. An API key
 * keeps its one workspace.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/client';
import { sql } from '@quill/db';
import { APP_URL, bootHarness, errorText, initialize, structured, type Harness } from './mcp-harness';
import { startFakeIdentityProvider, type FakeIdentityProvider } from './fake-identity-provider';

let idp: FakeIdentityProvider;
const open: Harness[] = [];
beforeAll(async () => {
  idp = await startFakeIdentityProvider();
});
afterAll(async () => {
  await Promise.all(open.map((h) => h.close()));
  await idp.close();
});

async function boot(env: Parameters<typeof bootHarness>[0] = {}) {
  const h = await bootHarness(env, { oauth: { issuer: idp.issuer } });
  open.push(h);
  return h;
}

const LEAD = {
  version: 1,
  steps: [
    { key: 'name', type: 'name', question: 'What is your name?', required: true },
    { key: 'email', type: 'email', question: 'What is your work email?', required: true },
  ],
};

type Role = 'owner' | 'admin' | 'member';

/** A person the directory knows under a fresh subject, with no member anywhere yet. */
function newPerson(h: Harness) {
  const subject = `user_${randomUUID().slice(0, 8)}`;
  const personId = randomUUID();
  const email = `${subject}@example.com`;
  h.people.set(subject, { id: personId, email });
  return { subject, personId, email };
}

/** Give `p` a member in `accountId` with `role` (an access grant when `grant` is set). */
async function join(
  h: Harness,
  p: { personId: string; email: string },
  accountId: string,
  role: Role,
  opts: { status?: string; grant?: 'staff' } = {},
): Promise<string> {
  const memberId = randomUUID();
  await h.db.run(
    sql`INSERT INTO member (id, account_id, handle, display_name, email, role, status, external_id, access_grant, created_at)
        VALUES (${memberId}, ${accountId}, ${`p-${memberId.slice(0, 8)}`}, ${'Spec Person'}, ${p.email}, ${role},
          ${opts.status ?? 'active'}, ${p.personId}, ${opts.grant ?? null}, ${Date.now()})`,
  );
  return memberId;
}

/** A person who is admin of the seeded workspace (Acme) and a plain member of the other one (Globex). */
async function twoWorkspaces(h: Harness) {
  const p = newPerson(h);
  const acmeMember = await join(h, p, h.accountId, 'admin');
  const globexMember = await join(h, p, h.other.accountId, 'member');
  return { ...p, acmeMember, globexMember };
}

async function signIn(h: Harness, subject: string): Promise<Client> {
  return h.signIn(idp.client(subject));
}

type Listed = { workspaces: Array<{ id: string; name: string; role: string }>; next_step: string };

describe('list_my_workspaces', () => {
  it('lists every workspace where the person is an active member, with its name, role and id', async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces).toEqual([
      { id: h.accountId, name: 'Acme Inc.', role: 'admin' },
      { id: h.other.accountId, name: 'Globex', role: 'member' },
    ]);
    expect(listed.next_step).toMatch(/workspace_id/);
  });
});

describe('list_my_workspaces, what it leaves out', () => {
  it('leaves out a staff access grant, a pending invitation and a disabled member', async () => {
    const h = await boot();
    const p = newPerson(h);
    await join(h, p, h.accountId, 'member');
    await join(h, p, h.other.accountId, 'admin', { grant: 'staff' });
    const third = randomUUID();
    await h.db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${third}, 'initech', 'Initech', ${Date.now()})`);
    await join(h, p, third, 'member', { status: 'invited' });
    const c = await signIn(h, p.subject);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces.map((w) => w.id)).toEqual([h.accountId]);
    // The staff grant's workspace cannot be named either.
    const named = await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.other.accountId } });
    expect(errorText(named)).toMatch(/^NOT_FOUND/);
  });
});

describe('a person with two workspaces and a different role in each', () => {
  it('asks for workspace_id on a call that names none, and points at list_my_workspaces', async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);
    for (const name of ['list_forms', 'create_form'] as const) {
      const args = name === 'create_form' ? { name: 'Nowhere', config: LEAD } : {};
      const text = errorText(await c.callTool({ name, arguments: args }));
      expect(text).toMatch(/^WORKSPACE_REQUIRED/);
      expect(text).toContain('list_my_workspaces');
    }
    expect(await h.db.get(sql`SELECT id FROM form WHERE name = 'Nowhere'`)).toBeUndefined();
  });

  it('acts in the workspace each call names, as the member and role it holds there, and says where', async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);

    type Who = { workspace: { id: string; name: string }; member: { id: string; role: string } };
    const inAcme = structured<Who>(await c.callTool({ name: 'whoami', arguments: { workspace_id: h.accountId } }));
    expect(inAcme).toMatchObject({ workspace: { id: h.accountId }, member: { id: p.acmeMember, role: 'admin' } });
    const inGlobex = structured<Who>(await c.callTool({ name: 'whoami', arguments: { workspace_id: h.other.accountId } }));
    expect(inGlobex).toMatchObject({ workspace: { id: h.other.accountId, name: 'Globex' }, member: { id: p.globexMember, role: 'member' } });

    type Created = { form: { id: string }; workspace: { id: string; name: string } };
    const created = await c.callTool({
      name: 'create_form',
      arguments: { name: 'Globex lead form', config: LEAD, workspace_id: h.other.accountId },
    });
    const form = structured<Created>(created);
    expect(form.workspace).toEqual({ id: h.other.accountId, name: 'Globex' });
    expect((created as { content: Array<{ text: string }> }).content[0]!.text).toContain('Globex');
    const row = await h.db.get<{ account_id: string; created_via: string }>(
      sql`SELECT account_id, created_via FROM form WHERE id = ${form.form.id}`,
    );
    expect(row).toEqual({ account_id: h.other.accountId, created_via: 'mcp' });
    const audit = JSON.parse(h.audit.at(-1)!) as Record<string, unknown>;
    expect(audit).toMatchObject({ tool: 'create_form', accountId: h.other.accountId, memberId: p.globexMember, personId: p.personId });

    // Each list holds its own workspace's forms only, and says which one it is.
    type Forms = { forms: Array<{ id: string }>; workspace: { id: string } };
    const globex = structured<Forms>(await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.other.accountId } }));
    expect(globex.workspace.id).toBe(h.other.accountId);
    expect(globex.forms.map((f) => f.id).sort()).toEqual([h.other.formId, form.form.id].sort());
    const acme = structured<Forms>(await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.accountId } }));
    expect(acme.workspace.id).toBe(h.accountId);
    expect(acme.forms.map((f) => f.id)).toContain(h.formId);
    expect(acme.forms.map((f) => f.id)).not.toContain(form.form.id);

    // The other tools follow the named workspace too.
    for (const [name, args] of [
      ['get_form', { form_id: form.form.id }],
      ['list_responses', { form_id: form.form.id }],
      ['get_form_analytics', { form_id: form.form.id }],
    ] as const) {
      const ok = structured<{ workspace: { id: string } }>(
        await c.callTool({ name, arguments: { ...args, workspace_id: h.other.accountId } }),
      );
      expect(ok.workspace.id).toBe(h.other.accountId);
    }
  });

  it('whoami without workspace_id names the person and every workspace, and acts in none', async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);
    const who = structured<{
      workspace: unknown;
      member: unknown;
      key: unknown;
      person: { id: string; email: string };
      workspaces: Array<{ id: string; role: string }>;
    }>(await c.callTool({ name: 'whoami', arguments: {} }));
    expect(who).toMatchObject({ workspace: null, member: null, key: null, person: { id: p.personId, email: p.email } });
    expect(who.workspaces.map((w) => [w.id, w.role])).toEqual([
      [h.accountId, 'admin'],
      [h.other.accountId, 'member'],
    ]);
  });
});

describe('isolation', () => {
  it('answers NOT_FOUND, with nothing about the workspace, for a workspace_id where the person is not a member', async () => {
    const h = await boot();
    const p = newPerson(h);
    await join(h, p, h.accountId, 'owner');
    const c = await signIn(h, p.subject);
    const stranger = randomUUID();
    for (const [name, args] of [
      ['whoami', {}],
      ['list_forms', {}],
      ['get_form', { form_id: h.other.formId }],
      ['create_form', { name: 'Smuggled', config: LEAD }],
      ['update_form', { form_id: h.other.formId, name: 'Taken', expected_updated_at: 0 }],
      ['publish_form', { form_id: h.other.formId }],
      ['revert_form', { form_id: h.other.formId }],
      ['list_responses', { form_id: h.other.formId }],
      ['get_form_analytics', { form_id: h.other.formId }],
    ] as const) {
      for (const workspaceId of [h.other.accountId, stranger]) {
        const text = errorText(await c.callTool({ name, arguments: { ...args, workspace_id: workspaceId } }));
        expect(text, `${name} in ${workspaceId}`).toMatch(/^NOT_FOUND: No workspace of yours has this id\./);
        expect(text).not.toContain('Globex');
      }
    }
    expect(await h.db.get(sql`SELECT id FROM form WHERE name = 'Smuggled'`)).toBeUndefined();
    const untouched = await h.db.get<{ name: string }>(sql`SELECT name FROM form WHERE id = ${h.other.formId}`);
    expect(untouched!.name).toBe('Globex Secret Survey');
  });

  it("answers NOT_FOUND for another workspace's form, even inside a workspace the person belongs to", async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);
    const text = errorText(await c.callTool({ name: 'get_form', arguments: { form_id: h.other.formId, workspace_id: h.accountId } }));
    expect(text).toMatch(/^NOT_FOUND/);
    expect(text).not.toContain('Globex');
  });
});

describe('mid-session', () => {
  it('drops a workspace the person was removed from on the very next call, and keeps the other', async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);
    expect(structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} })).workspaces).toHaveLength(2);

    await h.db.run(sql`DELETE FROM member WHERE id = ${p.globexMember}`);
    const after = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(after.workspaces.map((w) => w.id)).toEqual([h.accountId]);
    expect(errorText(await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.other.accountId } }))).toMatch(/^NOT_FOUND/);
    // Down to one workspace: it is used without asking.
    const acme = structured<{ workspace: { id: string } }>(await c.callTool({ name: 'list_forms', arguments: {} }));
    expect(acme.workspace.id).toBe(h.accountId);
  });

  it('drops a disabled member the same way, and reads a changed role on the next call', async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);
    await h.db.run(sql`UPDATE member SET role = 'owner' WHERE id = ${p.globexMember}`);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces.find((w) => w.id === h.other.accountId)!.role).toBe('owner');
    await h.db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${p.acmeMember}`);
    const after = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(after.workspaces.map((w) => w.id)).toEqual([h.other.accountId]);
  });
});

describe('one workspace, or none', () => {
  it('uses the only workspace without workspace_id, and says which one it is', async () => {
    const h = await boot();
    const p = newPerson(h);
    const member = await join(h, p, h.other.accountId, 'member');
    const c = await signIn(h, p.subject);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed).toMatchObject({ workspaces: [{ id: h.other.accountId, name: 'Globex', role: 'member' }] });
    const who = structured<{ workspace: { id: string }; member: { id: string } }>(await c.callTool({ name: 'whoami', arguments: {} }));
    expect(who).toMatchObject({ workspace: { id: h.other.accountId }, member: { id: member } });
    const forms = await c.callTool({ name: 'list_forms', arguments: {} });
    expect(structured<{ workspace: { name: string } }>(forms).workspace.name).toBe('Globex');
    expect((forms as { content: Array<{ text: string }> }).content[0]!.text).toMatch(/^In workspace "Globex": /);
  });

  it('lets a person with no workspace connect, and every workspace tool says to open dForms once', async () => {
    const h = await boot();
    const p = newPerson(h);
    const c = await signIn(h, p.subject);
    const who = structured<{ person: { id: string }; workspaces: unknown[]; workspace: unknown }>(
      await c.callTool({ name: 'whoami', arguments: {} }),
    );
    expect(who).toMatchObject({ person: { id: p.personId }, workspaces: [], workspace: null });
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces).toEqual([]);
    expect(listed.next_step).toContain('open dForms once');
    const text = errorText(await c.callTool({ name: 'list_forms', arguments: {} }));
    expect(text).toMatch(/^NO_WORKSPACE/);
    expect(text).toContain(`open dForms once with this account (${APP_URL})`);
  });
});

describe('with an API key', () => {
  it("refuses a workspace_id other than the key's, and takes the key's own or none as before", async () => {
    const h = await boot();
    const { key } = await h.key('admin');
    const c = await h.connect(key);
    for (const other of [h.other.accountId, randomUUID()]) {
      const text = errorText(await c.callTool({ name: 'list_forms', arguments: { workspace_id: other } }));
      expect(text).toMatch(/^WORKSPACE_MISMATCH/);
      expect(text).not.toContain('Globex');
      expect(errorText(await c.callTool({ name: 'create_form', arguments: { name: 'Escaped', config: LEAD, workspace_id: other } }))).toMatch(
        /^WORKSPACE_MISMATCH/,
      );
    }
    expect(await h.db.get(sql`SELECT id FROM form WHERE name = 'Escaped'`)).toBeUndefined();
    const own = structured<{ workspace: { id: string } }>(await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.accountId } }));
    expect(own.workspace.id).toBe(h.accountId);
    const none = structured<{ workspace: { id: string; name: string } }>(await c.callTool({ name: 'list_forms', arguments: {} }));
    expect(none.workspace).toEqual({ id: h.accountId, name: 'Acme Inc.' });
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces).toEqual([{ id: h.accountId, name: 'Acme Inc.', role: 'admin' }]);
    const who = structured<{ person: unknown; key: { prefix: string } }>(await c.callTool({ name: 'whoami', arguments: {} }));
    expect(who).toMatchObject({ person: null, key: { prefix: key.slice(0, 12) } });
  });
});

describe('limits', () => {
  it('counts each workspace against the member there, so one workspace never spends the other budget', async () => {
    const h = await boot({ MCP_RATE_LIMIT_CAPACITY: '3', MCP_RATE_LIMIT_REFILL_PER_SEC: '0.001' });
    const p = await twoWorkspaces(h);
    const auth = { authorization: `Bearer ${idp.token(p.subject, `${h.base}/mcp`)}` };
    const call = (workspaceId: string) => ({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_forms', arguments: { workspace_id: workspaceId } },
    });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await h.post(call(h.accountId), auth)).status);
    expect(codes).toEqual([200, 200, 200, 429]);
    expect((await h.post(call(h.other.accountId), auth)).status).toBe(200);
    // A request that acts in no workspace counts against the person, not a member.
    expect((await h.post(initialize('2025-06-18'), auth)).status).toBe(200);
  });
});
