import 'server-only';
import { sortTags, type TagInfo } from '../lib/repo.ts';
import {
  attributeCommits,
  buildChanges,
  capCommits,
  contributors,
  pagesForNewest,
  shapeCommit,
  shapePull,
  type Change,
  type Commit,
  type Person,
  type PullRequest,
} from '../lib/shape.ts';

export const MAX_COMMITS = Number(process.env.MAX_COMMITS ?? 150);
const TTL_MS = 15 * 60 * 1000;
const MAX_CACHE = 400;
const token = process.env.GITHUB_TOKEN?.trim() || null;
const PULL_LOOKUPS = token ? 40 : 8;
const ASSOC_LOOKUPS = token ? 25 : 0;

export class GitHubError extends Error {
  constructor(
    public code: 'not_found' | 'rate_limited' | 'bad_range' | 'empty' | 'upstream',
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

type Quota = { limit: number; remaining: number; reset: number; resource: string };
const quotas = new Map<string, Quota>();
const cache = new Map<string, { at: number; data: unknown }>();

export function quotaSnapshot() {
  const core = quotas.get('core');
  return { authenticated: Boolean(token), core: core ?? null };
}

function resetText(reset: number) {
  const mins = Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000));
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

function rateLimitError(resource: string, reset: number) {
  const hint = token ? '' : ' Unauthenticated requests get 60 per hour; set GITHUB_TOKEN to raise that.';
  return new GitHubError(
    'rate_limited',
    `GitHub's ${resource} API rate limit is used up. It resets in ${resetText(reset)}.${hint}`,
    429,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function gh<T>(path: string, resource: 'core' | 'search' = 'core', shape: (d: any) => T = (d) => d): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;

  const q = quotas.get(resource);
  if (q && q.remaining <= 0 && q.reset * 1000 > Date.now()) throw rateLimitError(resource, q.reset);

  let res: Response;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'shipnotes',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
  } catch {
    throw new GitHubError('upstream', 'Could not reach GitHub. Try again in a moment.');
  }

  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0);
  if (remaining !== null) {
    quotas.set(res.headers.get('x-ratelimit-resource') ?? resource, {
      limit: Number(res.headers.get('x-ratelimit-limit') ?? 0),
      remaining: Number(remaining),
      reset,
      resource,
    });
  }

  if (res.status === 403 || res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? 0);
    if (remaining === '0' || retryAfter) {
      throw rateLimitError(resource, retryAfter ? Date.now() / 1000 + retryAfter : reset);
    }
    throw new GitHubError('upstream', 'GitHub refused the request. The repo may be private.', 403);
  }
  if (res.status === 404) throw new GitHubError('not_found', 'Repo or ref not found. Is the repo public?', 404);
  if (res.status === 422) throw new GitHubError('bad_range', 'GitHub could not compare those refs.', 422);
  if (!res.ok) throw new GitHubError('upstream', `GitHub returned ${res.status}.`);

  const data = shape(await res.json());
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(path, { at: Date.now(), data });
  return data;
}

const enc = encodeURIComponent;

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function listTags(owner: string, repo: string): Promise<TagInfo[]> {
  const key = `tags:${owner}/${repo}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as TagInfo[];

  const releases = await gh<any[]>(`/repos/${enc(owner)}/${enc(repo)}/releases?per_page=40`);
  let tags: TagInfo[] = releases
    .filter((r) => !r.draft && r.tag_name)
    .map((r) => ({ name: r.tag_name, date: r.published_at ?? r.created_at ?? null, prerelease: !!r.prerelease }));
  if (tags.length < 2) {
    const raw = await gh<any[]>(`/repos/${enc(owner)}/${enc(repo)}/tags?per_page=40`);
    const seen = new Set(tags.map((t) => t.name));
    tags = tags.concat(
      raw.filter((t) => !seen.has(t.name)).map((t) => ({ name: t.name, date: null, prerelease: false })),
    );
  }
  const sorted = sortTags(tags).slice(0, 30);
  cache.set(key, { at: Date.now(), data: sorted });
  return sorted;
}

export type RangeData = {
  repoUrl: string;
  totalCommits: number;
  analyzedCommits: number;
  truncated: boolean;
  baseDate: string | null;
  headDate: string | null;
  changes: Change[];
  contributors: Person[];
  prDetails: { found: number; missing: number };
};

type Progress = (step: string) => void;

async function compare(owner: string, repo: string, base: string, head: string) {
  const path = (page: number) =>
    `/repos/${enc(owner)}/${enc(repo)}/compare/${enc(base)}...${enc(head)}?per_page=100&page=${page}`;
  // Shape before caching: raw compare payloads carry up to 300 file diffs.
  const shape = (d: any) => ({
    total: (d.total_commits ?? 0) as number,
    status: String(d.status ?? ''),
    baseDate: (d.merge_base_commit?.commit?.committer?.date ?? null) as string | null,
    commits: ((d.commits ?? []) as any[]).map(shapeCommit),
  });
  const first = await gh(path(1), 'core', shape);
  let commits: Commit[] = first.commits;
  if (first.total > commits.length) {
    const pages = pagesForNewest(first.total, MAX_COMMITS);
    const rest = await Promise.all(pages.filter((p) => p !== 1).map((p) => gh(path(p), 'core', shape)));
    commits = [...(pages.includes(1) ? commits : []), ...rest.flatMap((r) => r.commits)];
  }
  return { total: first.total, commits: capCommits(commits, MAX_COMMITS), baseDate: first.baseDate, status: first.status };
}

async function findPulls(owner: string, repo: string, numbers: number[], from: string | null, to: string | null) {
  const pulls = new Map<number, PullRequest>();
  if (!numbers.length) return pulls;
  const want = new Set(numbers);

  if (from && to) {
    const start = new Date(new Date(from).getTime() - 3 * 864e5).toISOString().slice(0, 19) + 'Z';
    const end = new Date(new Date(to).getTime() + 864e5).toISOString().slice(0, 19) + 'Z';
    const q = `repo:${owner}/${repo} is:pr is:merged merged:${start}..${end}`;
    try {
      for (let page = 1; page <= 2; page++) {
        const items = await gh(`/search/issues?q=${enc(q)}&per_page=100&page=${page}`, 'search', (d: any) =>
          ((d.items ?? []) as any[]).map(shapePull),
        );
        for (const pr of items) if (want.has(pr.number)) pulls.set(pr.number, pr);
        if (items.length < 100 || pulls.size === want.size) break;
      }
    } catch (err) {
      if (!(err instanceof GitHubError)) throw err;
    }
  }

  const missing = numbers.filter((n) => !pulls.has(n)).slice(0, PULL_LOOKUPS);
  const results = await Promise.allSettled(
    missing.map((n) => gh(`/repos/${enc(owner)}/${enc(repo)}/pulls/${n}`, 'core', shapePull)),
  );
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') pulls.set(missing[i], r.value);
  });
  return pulls;
}

/** Fetches the compare range and the merged PRs behind it, shaped for the model. */
export async function fetchRange(
  owner: string,
  repo: string,
  base: string,
  head: string,
  progress: Progress = () => {},
): Promise<RangeData> {
  progress('Fetching the compare range');
  const { total, commits, baseDate, status } = await compare(owner, repo, base, head);
  if (status === 'behind' || (total === 0 && status !== 'identical')) {
    throw new GitHubError('bad_range', `"${head}" is behind "${base}". Swap the two refs.`, 422);
  }
  if (!commits.length) throw new GitHubError('empty', 'There are no commits between those two refs.', 422);

  const owners = attributeCommits(commits);
  const numbers = [...new Set(owners.values())];

  progress(`Matching ${numbers.length} pull requests`);
  const headDate = commits[commits.length - 1]?.date ?? null;
  const pulls = await findPulls(owner, repo, numbers, baseDate ?? commits[0]?.date ?? null, headDate);

  const extra = new Map<string, number>();
  const orphans = commits.filter((c: Commit) => !owners.has(c.sha) && c.parents.length < 2).slice(-ASSOC_LOOKUPS);
  if (orphans.length && ASSOC_LOOKUPS) {
    const found = await Promise.allSettled(
      orphans.map((c) =>
        gh(`/repos/${enc(owner)}/${enc(repo)}/commits/${c.sha}/pulls`, 'core', (d: any[]) =>
          d.filter((p) => p.merged_at).map(shapePull),
        ),
      ),
    );
    found.forEach((r, i) => {
      const pr = r.status === 'fulfilled' ? r.value[0] : null;
      if (!pr) return;
      extra.set(orphans[i].sha, pr.number);
      if (!pulls.has(pr.number)) pulls.set(pr.number, pr);
    });
  }

  const repoUrl = `https://github.com/${owner}/${repo}`;
  const changes = buildChanges(commits, pulls, extra, repoUrl);
  const prCount = changes.filter((c) => c.kind === 'pr').length;
  const found = changes.filter((c) => c.kind === 'pr' && c.number !== null && pulls.has(c.number)).length;
  return {
    repoUrl,
    totalCommits: total,
    analyzedCommits: commits.length,
    truncated: total > commits.length,
    baseDate,
    headDate,
    changes,
    contributors: contributors(changes),
    prDetails: { found, missing: prCount - found },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
