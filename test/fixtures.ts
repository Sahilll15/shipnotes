const user = (login: string, type = 'User') => ({
  login,
  avatar_url: `https://avatars.githubusercontent.com/u/1?v=4&${login}`,
  html_url: `https://github.com/${login}`,
  type,
});

export const rawCommit = (sha: string, message: string, parents: string[], login = 'dai-shi') => ({
  sha: sha.padEnd(40, '0'),
  html_url: `https://github.com/o/r/commit/${sha.padEnd(40, '0')}`,
  commit: { message, author: { name: login, date: '2026-08-01T00:00:00Z' }, committer: { date: '2026-08-01T00:00:00Z' } },
  author: user(login),
  parents: parents.map((p) => ({ sha: p.padEnd(40, '0') })),
  files: [{ filename: 'huge.diff' }],
});

export const rawSearchItem = (number: number, title: string, labels: string[] = [], login = 'alice') => ({
  number,
  title,
  body: `<!-- template -->\nThis changes ${title}.\n- [x] I ran tests\n![shot](https://x/y.png)`,
  labels: labels.map((name) => ({ name, color: '000' })),
  user: user(login, login.endsWith('[bot]') ? 'Bot' : 'User'),
  html_url: `https://github.com/o/r/pull/${number}`,
  pull_request: { merged_at: '2026-08-01T00:00:00Z' },
});
