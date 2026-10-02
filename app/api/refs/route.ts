import { defaultRange, parseRepo } from '@/lib/repo.ts';
import { GitHubError, listTags, quotaSnapshot } from '@/server/github.ts';
import { check, tooMany } from '@/server/ratelimit.ts';

export async function GET(req: Request) {
  const input = new URL(req.url).searchParams.get('repo') ?? '';
  if (input.length > 200) return Response.json({ error: 'Repo name is too long.' }, { status: 413 });
  const id = parseRepo(input);
  if (!id) return Response.json({ error: 'Enter a public GitHub repo as owner/repo or a github.com URL.' }, { status: 400 });

  const gate = check(req, 'refs');
  if (!gate.ok) return tooMany(gate.retryAfter);

  try {
    const tags = await listTags(id.owner, id.repo);
    return Response.json({ repo: `${id.owner}/${id.repo}`, tags, default: defaultRange(tags), github: quotaSnapshot() });
  } catch (err) {
    if (err instanceof GitHubError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
    console.error(err);
    return Response.json({ error: 'Could not load tags.' }, { status: 500 });
  }
}
