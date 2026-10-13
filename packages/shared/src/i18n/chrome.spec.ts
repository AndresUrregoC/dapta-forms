import { describe, expect, it } from 'vitest';
import { getMessages } from './index';

describe('admin.chrome docs link', () => {
  it('points each language at its own documentation site', () => {
    expect(getMessages('en').admin.chrome.docsHref).toBe('https://docs.dapta.ai/dapta-forms/forms');
    expect(getMessages('es').admin.chrome.docsHref).toBe('https://docs.dapta.ai/dapta-docs-es/dapta-forms/forms');
  });

  it('carries absolute URLs (the rail opens them in a new tab, so a relative path would 404 in the app)', () => {
    for (const locale of ['en', 'es'] as const) {
      const url = new URL(getMessages(locale).admin.chrome.docsHref);
      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe('docs.dapta.ai');
    }
  });

  it('labels the nav item in both languages', () => {
    expect(getMessages('en').admin.chrome.nav.docs).toBe('Docs');
    expect(getMessages('es').admin.chrome.nav.docs).toBe('Documentación');
  });
});

describe('admin.chrome developers item', () => {
  it('labels the nav item in both languages', () => {
    expect(getMessages('en').admin.chrome.nav.developers).toBe('Developers');
    expect(getMessages('es').admin.chrome.nav.developers).toBe('Developers');
  });
});

describe('admin.developers keys copy', () => {
  it('keeps the masked key and the revoke prompt templated in both languages', () => {
    for (const locale of ['en', 'es'] as const) {
      const m = getMessages(locale).admin.developers.keys;
      expect(m.masked).toContain('{last4}');
      expect(m.maskedLabel).toContain('{last4}');
      expect(m.revokeLabel).toContain('{name}');
      expect(m.revokeConfirm).toContain('{name}');
    }
  });

  it('names the ten-key limit in the limit error', () => {
    expect(getMessages('en').admin.developers.keys.errorLimit).toContain('10');
    expect(getMessages('es').admin.developers.keys.errorLimit).toContain('10');
  });
});
