/**
 * API v1 validation, end to end through the real controllers on in-memory
 * SQLite (same harness as draft-publish.spec.ts):
 *
 *   1. every validation 400 of the form, branding and destinations routes
 *      carries `issues[]`: every problem, each with its dot path inside the
 *      request body, its message and a stable code. `message` stays the first
 *      issue's, as it always was;
 *   2. with an API key (`via: 'api_key'`), the config may not carry the fields
 *      the editor has no control for (UNSUPPORTED_FIELD), steps need a question
 *      (EMPTY_QUESTION), a PUT config needs `steps` (STEPS_REQUIRED), and the
 *      saved config is the engine's normalized one;
 *   3. with a session, nothing of (2) applies: the editor saves through the
 *      same routes and legacy forms carry those fields, so they keep saving
 *      exactly as before;
 *   4. POST /v1/forms drops the HubSpot mirror's `formGuid` and
 *      `formSignature`, for every caller, like duplicating already does.
 *
 * Key principals are built by hand (`via: 'api_key'` on the seeded owner): the
 * rules read the principal, not how a key is resolved.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { createDb, migrate, seed, getFormById, sql, type Db } from '@quill/db';
import { formConfigSchema, type FormConfig } from '@quill/types';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { BrandingController } from './branding.controller';
import { FormDestinationsController } from './integrations.controller';
import { LocalAuthProvider, type HostPrincipal, type ReqLike } from './auth.provider';

let db: Db;
let accountId: string;
let formId: string;
/** The seeded owner through a browser session. */
let session: { forms: AdminCrudController; branding: BrandingController; destinations: FormDestinationsController };
/** The same owner through an API key. */
let key: typeof session;

const req = (): ReqLike => ({ headers: {} });

function controllers(auth: AuthService) {
  return {
    // Submission/Analytics services are unused by the routes under test.
    forms: new AdminCrudController(db, auth, new AdminService(db), {} as never, {} as never),
    branding: new BrandingController(db, auth),
    destinations: new FormDestinationsController(db, auth),
  };
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + demo form "lead-qualifier"
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const auth = new AuthService(db, provider);
  const keyAuth = Object.create(auth) as AuthService;
  keyAuth.resolveHost = async (r: ReqLike): Promise<HostPrincipal> => ({
    ...(await auth.resolveHost(r)),
    via: 'api_key',
    apiKeyId: 'key_test',
  });
  session = controllers(auth);
  key = controllers(keyAuth);

  const row = await db.get<{ id: string; account_id: string }>(
    sql`SELECT id, account_id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`,
  );
  formId = row!.id;
  accountId = row!.account_id;
});

afterEach(async () => {
  await db.close();
});

interface Issue {
  path: string;
  message: string;
  code: string;
}
interface Refusal {
  error: string;
  message: string;
  issues: Issue[];
}

/** The body of the 400 a call must answer with. */
async function refusal(call: Promise<unknown>): Promise<Refusal> {
  const err = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BadRequestException);
  return (err as BadRequestException).getResponse() as Refusal;
}

const paths = (r: Refusal) => r.issues.map((i) => i.path);
/** A stored config, typed (the controller returns rows with `config: unknown`). */
const cfg = (c: unknown) => c as FormConfig;

const step = (over: Record<string, unknown> = {}) => ({
  key: 'company',
  type: 'text',
  question: 'Company?',
  ...over,
});
const config = (steps: unknown[], extra: Record<string, unknown> = {}) => ({
  version: 1,
  steps,
  ...extra,
});

describe('issues[] on validation errors (every caller)', () => {
  it('returns all three problems of a config, each with its dot path', async () => {
    const r = await refusal(
      session.forms.updateForm(req(), formId, {
        config: {
          version: 2,
          steps: [step({ type: 'bogus' }), step({ key: 'b', question: 'x'.repeat(501) })],
        },
      }),
    );
    expect(r.error).toBe('BAD_REQUEST');
    expect(paths(r).sort()).toEqual(['config.steps.0.type', 'config.steps.1.question', 'config.version']);
    for (const issue of r.issues) {
      expect(issue.message).toEqual(expect.any(String));
      expect(issue.code).toEqual(expect.any(String));
    }
    // `message` is still the first issue's, as before `issues[]` existed.
    expect(r.message).toBe(r.issues[0]!.message);
  });

  it('a key caller gets the same zod issues', async () => {
    const r = await refusal(key.forms.createForm(req(), { name: '', config: config([step({ type: 'bogus' })]) }));
    expect(paths(r)).toEqual(expect.arrayContaining(['name', 'config.steps.0.type']));
  });

  it('branding writes list every problem too', async () => {
    const r = await refusal(session.branding.put(req(), { primaryColor: 'not a color!', radius: 'huge' }));
    expect(r.error).toBe('BAD_REQUEST');
    expect(paths(r).sort()).toEqual(['primaryColor', 'radius']);
    expect(r.message).toBe(r.issues[0]!.message);
  });

  it('destination writes list every problem too', async () => {
    const r = await refusal(
      session.destinations.putDestinations(req(), formId, {
        destinations: [{ type: 'webhook', enabled: true, settings: { url: 'ftp://example.com' } }],
      }),
    );
    expect(paths(r)).toEqual(['destinations.0.settings.url']);
  });
});
