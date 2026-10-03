import { APIError } from 'openai';
import { isValidRef, parseRepo } from '@/lib/repo.ts';
import { cachedResult, generate } from '@/server/generate.ts';
import { GitHubError } from '@/server/github.ts';
import { gate } from '@/server/ratelimit.ts';

export const maxDuration = 120;
const MAX_BODY = 2_000;

const bad = (error: string, status = 400) => Response.json({ error }, { status });

function explain(err: unknown) {
  if (err instanceof GitHubError) return { message: err.message, code: err.code };
  if (err instanceof APIError) {
    if (err.status === 429) return { message: 'The model is busy right now. Try again in a minute.', code: 'model_busy' };
    return { message: 'The model request failed. Try again.', code: 'model_error' };
  }
  console.error(err);
  return { message: 'Something went wrong while writing the notes.', code: 'internal' };
}

export async function POST(req: Request) {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return bad('Request is too large.', 413);
  const text = await req.text();
  if (text.length > MAX_BODY) return bad('Request is too large.', 413);

  let body: { repo?: unknown; base?: unknown; head?: unknown };
  try {
    body = JSON.parse(text || '{}');
  } catch {
    return bad('Body must be JSON.');
  }
  const id = typeof body.repo === 'string' ? parseRepo(body.repo) : null;
  if (!id) return bad('Enter a public GitHub repo as owner/repo or a github.com URL.');
  const base = typeof body.base === 'string' ? body.base.trim() : '';
  const head = typeof body.head === 'string' ? body.head.trim() : '';
  if (!base || !head) return bad('Pick two refs to compare.');
  if (!isValidRef(base) || !isValidRef(head)) return bad('Refs must be tag names, branch names or commit SHAs.');
  if (base === head) return bad('Pick two different refs.');

  const key = `${id.owner}/${id.repo}:${base}:${head}`.toLowerCase();
  const hit = cachedResult(key);
  if (hit) return new Response(JSON.stringify({ type: 'result', data: { ...hit, cached: true } }) + '\n', {
    headers: { 'content-type': 'application/x-ndjson' },
  });

  const stop = await gate(req, 'notes');
  if (stop) return stop;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        const data = await generate(id.owner, id.repo, base, head, (step) => send({ type: 'progress', step }));
        send({ type: 'result', data });
      } catch (err) {
        send({ type: 'error', ...explain(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
}
