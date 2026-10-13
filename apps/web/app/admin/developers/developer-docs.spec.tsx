import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeveloperDocsView, SKILL_DOWNLOAD_PATH } from './developer-docs';
import { getDeveloperDocsMessages, type DeveloperDocsMessages } from './developer-docs-messages';

const en = getDeveloperDocsMessages('en');
const es = getDeveloperDocsMessages('es');
const API = 'https://api.forms.example.com';

const render = (m: DeveloperDocsMessages, apiUrl: string | null = API) =>
  renderToStaticMarkup(<DeveloperDocsView m={m} apiUrl={apiUrl} />);

/** Every string of a catalog, flattened. */
const strings = (m: unknown): string[] =>
  typeof m === 'string' ? [m] : Object.values(m as Record<string, unknown>).flatMap(strings);

describe('DeveloperDocsView', () => {
  it('shows this environment’s API URL and how to authenticate with it', () => {
    const html = render(en);
    expect(html).toContain(en.title);
    expect(html).toContain(`<code>${API}</code>`);
    expect(html).toContain(`curl ${API}/v1/me`);
    expect(html).toContain('Authorization: Bearer $DFORMS_API_KEY');
  });

  it('walks through create, edit, publish and revert', () => {
    const html = render(en);
    for (const [id, route] of [
      ['create', '/v1/forms'],
      ['edit', '/v1/forms/{id}'],
      ['publish', '/v1/forms/{id}/publish'],
      ['revert', '/v1/forms/{id}/revert'],
    ]) {
      expect(html).toContain(`data-testid="developer-docs-flow-${id}"`);
      expect(html).toContain(route);
    }
  });

  it('warns about the whole-config PUT, expectedUpdatedAt, destinations and the 429', () => {
    const html = render(en);
    expect(html).toContain('<code class="break-words');
    for (const token of ['PUT', 'expectedUpdatedAt', 'PUT /v1/forms/{id}/destinations', '429', 'Retry-After']) {
      expect(html).toContain(`${token}</code>`);
    }
  });

  it('offers the skill as a download from the session-protected route', () => {
    const html = render(en);
    expect(html).toContain(`href="${SKILL_DOWNLOAD_PATH}"`);
    expect(html).toContain('download=""');
    expect(html).toContain(en.skillButton);
  });

  it('says the address is missing instead of printing a wrong one, and holds the download back', () => {
    const html = render(en, null);
    expect(html).toContain('data-testid="developer-docs-api-url-missing"');
    expect(html).toContain('PUBLIC_API_URL');
    expect(html).not.toContain(`href="${SKILL_DOWNLOAD_PATH}"`);
    expect(html).toContain(en.skillUnavailable);
  });

  it('renders in Spanish', () => {
    const html = render(es);
    expect(html).toContain('Cómo usar la API');
    expect(html).toContain('Descargar el skill');
    expect(html).toContain('Ten en cuenta');
  });

  it('keeps both catalogs dash-free and Spanish in tuteo', () => {
    for (const s of [...strings(en), ...strings(es)]) {
      expect(s).not.toMatch(/\u2014|\u2015|\u2013/);
    }
    // Voseo forms that would slip into Rioplatense Spanish.
    for (const s of strings(es)) {
      expect(s).not.toMatch(/\b(vos|tenés|querés|podés|pedile|mandá|esperá|leé|cambiá)\b/i);
    }
  });

  it('keeps the same keys in both languages', () => {
    const keys = (m: unknown, prefix = ''): string[] =>
      typeof m === 'string'
        ? [prefix]
        : Object.entries(m as Record<string, unknown>).flatMap(([k, v]) => keys(v, `${prefix}.${k}`));
    expect(keys(es)).toEqual(keys(en));
  });
});
