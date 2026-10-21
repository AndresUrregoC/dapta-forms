/**
 * The person directory as the API boots it and as the MCP door reads it: off
 * with MCP OAuth off; with it on, the identity-service adapter, whose settings
 * are checked at boot; and a lookup's outcome in the door's terms.
 */
import { describe, expect, it } from 'vitest';
import { DoorRefusal, DoorUnavailable } from '@quill/mcp';
import { loadServerEnv } from '@quill/config/env';
import { createPersonDirectory, lookUpPerson, PersonRefused, type PersonDirectory } from './person-directory';
import { iamDirectoryConfig } from './person-directory.iam';

const OAUTH = {
  MCP_OAUTH_PROVIDER: 'workos',
  WORKOS_AUTHKIT_DOMAIN: 'https://auth.example.test',
  MCP_PUBLIC_URL: 'https://mcp.example.test/mcp',
};
const IAM = {
  IAM_DB_HOST: 'iam-db.example.test',
  IAM_DB_NAME: 'identity',
  IAM_DB_SCHEMA: 'identity_ms',
  IAM_DB_USER: 'reader',
  IAM_DB_PASS: 'spec-password',
};
const env = (over: Record<string, string | undefined> = {}) => loadServerEnv({ ...OAUTH, ...IAM, ...over } as NodeJS.ProcessEnv);

describe('booting the person directory', () => {
  it('is absent with MCP OAuth off, whatever identity database settings are present', () => {
    expect(createPersonDirectory(loadServerEnv({ ...IAM } as NodeJS.ProcessEnv))).toBeNull();
    expect(createPersonDirectory(loadServerEnv({}))).toBeNull();
  });

  it('reads the identity database with MCP OAuth on, over TLS, on the default port', () => {
    expect(iamDirectoryConfig(env())).toEqual({
      host: 'iam-db.example.test',
      port: 5432,
      database: 'identity',
      schema: 'identity_ms',
      user: 'reader',
      password: 'spec-password',
      tls: true,
    });
    expect(createPersonDirectory(env())).not.toBeNull();
  });

  it('takes another port, and plain text only on a loopback host', () => {
    expect(iamDirectoryConfig(env({ IAM_DB_PORT: '6543' }))).toMatchObject({ port: 6543, tls: true });
    expect(iamDirectoryConfig(env({ IAM_DB_HOST: '127.0.0.1' }))).toMatchObject({ tls: false });
    expect(iamDirectoryConfig(env({ IAM_DB_HOST: 'localhost' }))).toMatchObject({ tls: false });
  });

  it('refuses to boot naming every value that is missing or blank', () => {
    const boot = () => createPersonDirectory(env({ IAM_DB_HOST: undefined, IAM_DB_PASS: ' ' }));
    expect(boot).toThrow(/Refusing to boot/);
    expect(boot).toThrow(/IAM_DB_HOST, IAM_DB_PASS/);
    expect(() => createPersonDirectory(loadServerEnv({ ...OAUTH } as NodeJS.ProcessEnv))).toThrow(
      /IAM_DB_HOST, IAM_DB_NAME, IAM_DB_SCHEMA, IAM_DB_USER, IAM_DB_PASS/,
    );
  });

  it.each([
    ['a schema that is not a plain identifier', { IAM_DB_SCHEMA: 'identity; drop' }, /IAM_DB_SCHEMA/],
    ['a port that is not a port', { IAM_DB_PORT: '70000' }, /IAM_DB_PORT/],
    ['a port that is not a number', { IAM_DB_PORT: 'five' }, /IAM_DB_PORT/],
    ['a host with a scheme', { IAM_DB_HOST: 'postgres://iam-db.example.test' }, /IAM_DB_HOST/],
  ])('refuses to boot with %s', (_name, over, message) => {
    expect(() => createPersonDirectory(env(over))).toThrow(/Refusing to boot/);
    expect(() => createPersonDirectory(env(over))).toThrow(message);
  });
});

describe('a lookup, in the door\'s terms', () => {
  const directory = (personOf: PersonDirectory['personOf']): PersonDirectory => ({ personOf });

  it('passes a person, or nobody, through', async () => {
    const person = { id: 'p1', email: 'p1@example.com' };
    expect(await lookUpPerson(directory(async () => person), 'user_1')).toEqual(person);
    expect(await lookUpPerson(directory(async () => null), 'user_1')).toBeNull();
  });

  it('turns a refusal into a 403 with its message', async () => {
    const error = await lookUpPerson(directory(async () => Promise.reject(new PersonRefused('Contact support.'))), 'user_1').catch((e) => e);
    expect(error).toBeInstanceOf(DoorRefusal);
    expect((error as Error).message).toBe('Contact support.');
  });

  it('turns a directory that cannot be read into a 503 that says to retry, without its internals', async () => {
    const error = await lookUpPerson(
      directory(async () => Promise.reject(new Error('connect ECONNREFUSED 10.1.2.3:5432'))),
      'user_1',
      () => {},
    ).catch((e) => e);
    expect(error).toBeInstanceOf(DoorUnavailable);
    expect((error as Error).message).toMatch(/try again/i);
    expect((error as Error).message).not.toContain('10.1.2.3');
  });
});
