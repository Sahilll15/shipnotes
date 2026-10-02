export type RepoId = { owner: string; repo: string };

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;
const REF = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._\/@+-]{1,120}$/;

/** Accepts "owner/repo", "github.com/owner/repo" or a full GitHub URL. */
export function parseRepo(input: string): RepoId | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^git@github\.com:/i, '');
  s = s.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '');
  s = s.replace(/[?#].*$/, '').replace(/\.git$/i, '');
  const [owner, repo] = s.split('/');
  if (!owner || !repo) return null;
  const clean = repo.replace(/\.git$/i, '');
  if (!NAME.test(owner) || !NAME.test(clean) || owner.length > 39) return null;
  return { owner, repo: clean };
}

export function isValidRef(ref: string) {
  return REF.test(ref) && !ref.endsWith('.lock');
}

type Semver = [number, number, number, string];

function semver(tag: string): Semver | null {
  const m = /(?:^|[@/])v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(tag);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ''];
}

function cmp(a: Semver, b: Semver) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  if (a[3] === b[3]) return 0;
  if (!a[3]) return 1;
  if (!b[3]) return -1;
  return a[3] < b[3] ? -1 : 1;
}

export type TagInfo = { name: string; date: string | null; prerelease: boolean };

/**
 * Newest first. Plain semver tags (v1.2.3) sort by version so a backport like
 * v0.34.0 published after v1.20.0 does not become the default head.
 */
export function sortTags(tags: TagInfo[]): TagInfo[] {
  const plain = tags.filter((t) => /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(t.name));
  const rest = tags.filter((t) => !plain.includes(t));
  plain.sort((a, b) => cmp(semver(b.name)!, semver(a.name)!));
  rest.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  return [...plain, ...rest];
}

/** Default range: the two newest stable tags, falling back to any two. */
export function defaultRange(sorted: TagInfo[]): { base: string; head: string } | null {
  const stable = sorted.filter((t) => !t.prerelease && !semver(t.name)?.[3]);
  const pool = stable.length >= 2 ? stable : sorted;
  if (pool.length < 2) return null;
  return { head: pool[0].name, base: pool[1].name };
}
