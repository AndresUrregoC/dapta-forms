'use server';

import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { adminApi, ApiError, type CreatedApiKey } from '@/lib/admin-api';

/**
 * The writes behind the Developers page: create and revoke an API key in the
 * workspace the caller is in (the cookie's, like the rest of the admin). The
 * API is the gate for who may revoke what; these only turn its answer into a
 * stable code the page localizes, never a raw server string.
 */

const PAGE = '/admin/developers';

/** The spec's bound on a key's name, mirrored so a bad one never reaches the API. */
export const API_KEY_NAME_MAX = 60;

export type CreateApiKeyState =
  | { ok: true; key: CreatedApiKey }
  | { ok: false; code: 'INVALID' | 'KEY_LIMIT' | 'FORBIDDEN' | 'FAILED' };

/**
 * Create a key named `name`. The result is the ONLY place the full key ever
 * appears: the page shows it once and drops it when the dialog closes, and
 * nothing here logs it.
 */
export async function createApiKeyAction(name: string): Promise<CreateApiKeyState> {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || trimmed.length > API_KEY_NAME_MAX) return { ok: false, code: 'INVALID' };
  try {
    const key = await adminApi.createApiKey(trimmed);
    revalidatePath(PAGE);
    return { ok: true, key };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) {
      if (e.code === 'KEY_LIMIT') return { ok: false, code: 'KEY_LIMIT' };
      if (e.status === 400) return { ok: false, code: 'INVALID' };
      if (e.status === 403) return { ok: false, code: 'FORBIDDEN' };
    }
    return { ok: false, code: 'FAILED' };
  }
}

export type RevokeApiKeyState = { ok: true } | { ok: false; code: 'FORBIDDEN' | 'FAILED' };

/**
 * Revoke one key. A 404 counts as done: the page only lists keys of this
 * workspace, so a key the API cannot find was already revoked (in another
 * tab, or by an admin), and what the person asked for is true.
 */
export async function revokeApiKeyAction(id: string): Promise<RevokeApiKeyState> {
  if (typeof id !== 'string' || !id) return { ok: false, code: 'FAILED' };
  try {
    await adminApi.revokeApiKey(id);
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) {
      if (e.status === 404) {
        revalidatePath(PAGE);
        return { ok: true };
      }
      if (e.status === 403) return { ok: false, code: 'FORBIDDEN' };
    }
    return { ok: false, code: 'FAILED' };
  }
}
