/**
 * `/admin/developers` is a door, not a page: the address lives in skill zips
 * people already downloaded, and it has to land them on their keys.
 */
import { describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${to}` });
  }),
);
vi.mock('next/navigation', () => ({ redirect }));

import DevelopersIndex from './page';

describe('/admin/developers', () => {
  it('redirects to the API keys page', () => {
    expect(() => DevelopersIndex()).toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/admin/developers/keys');
  });
});
