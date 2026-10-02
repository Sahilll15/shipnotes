export type Person = { login: string; avatar: string; url: string; bot: boolean };

export type Commit = {
  sha: string;
  short: string;
  subject: string;
  body: string;
  date: string;
  parents: string[];
  author: Person | null;
  authorName: string;
  url: string;
};

export type PullRequest = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  author: Person | null;
  url: string;
  mergedAt: string | null;
  detailed: boolean;
};

/** One unit of change the model summarizes: a merged PR or a commit with no PR. */
export type Change = {
  id: string;
  kind: 'pr' | 'commit';
  number: number | null;
  sha: string | null;
  title: string;
  body: string;
  labels: string[];
  author: Person | null;
  url: string;
  commits: string[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export function shapePerson(raw: any): Person | null {
  if (!raw || typeof raw.login !== 'string') return null;
  return {
    login: raw.login,
    avatar: typeof raw.avatar_url === 'string' ? raw.avatar_url : '',
    url: typeof raw.html_url === 'string' ? raw.html_url : `https://github.com/${raw.login}`,
    bot: raw.type === 'Bot' || /\[bot\]$/.test(raw.login),
  };
}

export function shapeCommit(raw: any): Commit {
  const message: string = raw?.commit?.message ?? '';
  const [subject, ...rest] = message.split('\n');
  return {
    sha: raw.sha,
    short: String(raw.sha).slice(0, 7),
    subject: subject.trim(),
    body: rest.join('\n').trim(),
    date: raw?.commit?.committer?.date ?? raw?.commit?.author?.date ?? '',
    parents: Array.isArray(raw.parents) ? raw.parents.map((p: any) => p.sha) : [],
    author: shapePerson(raw.author),
    authorName: raw?.commit?.author?.name ?? 'unknown',
    url: raw.html_url ?? '',
  };
}

/** Works for both /pulls/{n} and /search/issues items. */
export function shapePull(raw: any): PullRequest {
  return {
    number: raw.number,
    title: String(raw.title ?? '').trim(),
    body: cleanBody(raw.body ?? ''),
    labels: Array.isArray(raw.labels)
      ? raw.labels.map((l: any) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)
      : [],
    author: shapePerson(raw.user),
    url: raw.html_url ?? '',
    mergedAt: raw.merged_at ?? raw.pull_request?.merged_at ?? null,
    detailed: true,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Strips PR-template noise so the model sees the author's actual words. */
export function cleanBody(body: string, max = 600) {
  const text = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .split('\n')
    .filter((l) => !/^\s*[-*]\s*\[[ xX]\]/.test(l))
    .filter((l) => !/^\s*#{1,6}\s*$/.test(l))
    .join('\n')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}...` : text;
}

/** PR number from a squash subject "fix: x (#123)" or a merge "Merge pull request #123 from". */
export function prNumberFromSubject(subject: string): number | null {
  const merge = /^Merge pull request #(\d+)\b/.exec(subject);
  if (merge) return Number(merge[1]);
  const squash = /\(#(\d+)\)\s*$/.exec(subject);
  return squash ? Number(squash[1]) : null;
}

/**
 * Maps commit sha to PR number. Squash commits cite the PR in the subject; for
 * merge commits, every off-mainline commit reachable from the second parent belongs to that PR.
 */
export function attributeCommits(commits: Commit[]): Map<string, number> {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const owner = new Map<string, number>();
  const mainline = new Set<string>();
  let cur = commits[commits.length - 1];
  while (cur && !mainline.has(cur.sha)) {
    mainline.add(cur.sha);
    cur = bySha.get(cur.parents[0])!;
  }

  for (const c of commits) {
    const n = prNumberFromSubject(c.subject);
    if (n !== null) owner.set(c.sha, n);
  }

  for (const c of commits) {
    const n = owner.get(c.sha);
    if (n === undefined || c.parents.length < 2 || !mainline.has(c.sha)) continue;
    const stack = c.parents.slice(1);
    while (stack.length) {
      const sha = stack.pop()!;
      const node = bySha.get(sha);
      if (!node || mainline.has(sha) || owner.has(sha)) continue;
      owner.set(sha, n);
      stack.push(...node.parents);
    }
  }
  return owner;
}

function stripPrSuffix(subject: string) {
  return subject.replace(/\s*\(#\d+\)\s*$/, '').trim();
}

/** Collapses commits into changes: one per PR, plus one per commit with no PR. */
export function buildChanges(
  commits: Commit[],
  pulls: Map<number, PullRequest>,
  extraOwners: Map<string, number> = new Map(),
  repoUrl = '',
): Change[] {
  const owners = attributeCommits(commits);
  for (const [sha, n] of extraOwners) if (!owners.has(sha)) owners.set(sha, n);

  const changes: Change[] = [];
  const prChanges = new Map<number, Change>();
  const anchors = new Map<number, Commit>();
  for (const c of commits) {
    const n = prNumberFromSubject(c.subject);
    if (n !== null && owners.get(c.sha) === n) anchors.set(n, c);
  }

  for (const c of commits) {
    const n = owners.get(c.sha);
    if (n === undefined) {
      changes.push({
        id: c.short,
        kind: 'commit',
        number: null,
        sha: c.sha,
        title: c.subject,
        body: cleanBody(c.body, 300),
        labels: [],
        author: c.author,
        url: c.url,
        commits: [c.sha],
      });
      continue;
    }
    const existing = prChanges.get(n);
    if (existing) {
      existing.commits.push(c.sha);
      continue;
    }
    const pr = pulls.get(n);
    const anchor = anchors.get(n) ?? c;
    const merge = /^Merge pull request/.test(anchor.subject);
    const change: Change = {
      id: `#${n}`,
      kind: 'pr',
      number: n,
      sha: null,
      title: pr?.title || (merge ? anchor.body.split('\n')[0] || anchor.subject : stripPrSuffix(anchor.subject)),
      body: pr?.body ?? cleanBody(anchor.body, 300),
      labels: pr?.labels ?? [],
      author: pr?.author ?? anchor.author,
      url: pr?.url || `${repoUrl}/pull/${n}`,
      commits: [c.sha],
    };
    prChanges.set(n, change);
    changes.push(change);
  }
  return changes;
}

export function contributors(changes: Change[]): Person[] {
  const seen = new Map<string, Person>();
  for (const c of changes) if (c.author && !seen.has(c.author.login)) seen.set(c.author.login, c.author);
  return [...seen.values()].sort((a, b) => Number(a.bot) - Number(b.bot));
}

/** Keeps the newest `cap` commits; compare lists oldest first. */
export function capCommits<T>(commits: T[], cap: number) {
  return commits.length > cap ? commits.slice(commits.length - cap) : commits;
}

/** Which compare pages (100 per page) hold the newest `cap` commits. */
export function pagesForNewest(total: number, cap: number, perPage = 100): number[] {
  const last = Math.max(1, Math.ceil(total / perPage));
  const pages: number[] = [];
  let have = 0;
  for (let p = last; p >= 1 && have < cap; p--) {
    pages.push(p);
    have += p === last ? total - (last - 1) * perPage : perPage;
  }
  return pages.reverse();
}
