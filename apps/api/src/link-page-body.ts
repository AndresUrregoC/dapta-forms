import { LINK_PAGE_MAX_BODY_BYTES } from '@quill/types';

/**
 * A JSON body reader for `PUT /v1/link-page` alone, mounted in `main.ts`
 * before Nest's own parser.
 *
 * Nest parses every JSON body with body-parser's default 100 KB ceiling, and
 * a link page at the schema's limits (an inlined logo plus 30 long links) is
 * about 160 KB, so a legitimate save would answer 413. Raising the global
 * ceiling would raise it for every route; this reads only this one route's
 * body, up to `LINK_PAGE_MAX_BODY_BYTES`, and marks it parsed (`_body`), which
 * makes the global parser step aside for that request. Every other request
 * passes through untouched.
 */
interface BodyReq {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  _body?: boolean;
  on(event: 'data', cb: (chunk: Buffer) => void): unknown;
  on(event: 'end' | 'error', cb: (err?: Error) => void): unknown;
  destroy?(): void;
}

interface BodyRes {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export const LINK_PAGE_BODY_PATH = '/v1/link-page';

export function isLinkPageWrite(req: Pick<BodyReq, 'method' | 'url' | 'headers'>): boolean {
  const path = (req.url ?? '').split('?')[0]?.replace(/\/+$/, '');
  const type = String(req.headers['content-type'] ?? '').toLowerCase();
  return req.method === 'PUT' && path === LINK_PAGE_BODY_PATH && type.startsWith('application/json');
}

function refuse(res: BodyRes, status: number, error: string, message: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error, message }));
}

export function linkPageBodyParser(limit: number = LINK_PAGE_MAX_BODY_BYTES) {
  return (req: BodyReq, res: BodyRes, next: (err?: unknown) => void): void => {
    if (req._body || !isLinkPageWrite(req)) {
      next();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        refuse(res, 413, 'PAYLOAD_TOO_LARGE', 'The page is larger than this endpoint accepts.');
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (err) => {
      if (done) return;
      done = true;
      next(err);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        req.body = text ? (JSON.parse(text) as unknown) : {};
      } catch {
        refuse(res, 400, 'BAD_REQUEST', 'The body is not valid JSON.');
        return;
      }
      req._body = true;
      next();
    });
  };
}
