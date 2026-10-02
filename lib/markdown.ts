import { CATEGORY_LABEL, groupBullets, type Bullet } from './notes.ts';
import type { Change, Person } from './shape.ts';

export type Tone = 'user' | 'dev';

export type ReleaseDoc = {
  repo: string;
  base: string;
  head: string;
  headline: string;
  summary: { user: string; dev: string };
  bullets: Bullet[];
  changes: Record<string, Change>;
  contributors: Person[];
};

function refText(id: string, doc: ReleaseDoc) {
  const c = doc.changes[id];
  if (!c) return id;
  return c.kind === 'pr' ? c.url : c.sha ?? id;
}

/** GitHub release body: GitHub autolinks PR URLs and SHAs, so they stay compact. */
export function toMarkdown(doc: ReleaseDoc, tone: Tone, includeInternal = false) {
  const out: string[] = [];
  out.push(`## ${doc.headline}`, '', doc.summary[tone], '');
  for (const group of groupBullets(doc.bullets, includeInternal)) {
    out.push(`### ${CATEGORY_LABEL[group.category]}`, '');
    for (const b of group.bullets) {
      const authors = [
        ...new Set(b.refs.map((id) => doc.changes[id]?.author?.login).filter(Boolean)),
      ].map((l) => `@${l}`);
      const by = authors.length ? ` by ${authors.join(', ')}` : '';
      out.push(`- ${b[tone]}${by} in ${b.refs.map((id) => refText(id, doc)).join(', ')}`);
    }
    out.push('');
  }
  const humans = doc.contributors.filter((p) => !p.bot);
  if (humans.length) {
    out.push('### Contributors', '', humans.map((p) => `@${p.login}`).join(', '), '');
  }
  out.push(
    `**Full Changelog**: https://github.com/${doc.repo}/compare/${encodeURIComponent(doc.base)}...${encodeURIComponent(doc.head)}`,
  );
  return out.join('\n');
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const URL_RE = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues|compare)\/([^\s<),]+)/g;

/** Inline subset GitHub uses in release bodies: code, bold, PR/compare URLs, @mentions, bare SHAs. */
export function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts
    .map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      let s = escapeHtml(part);
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(URL_RE, (_m, repo: string, kind: string, rest: string) => {
        const href = `https://github.com/${repo}/${kind}/${rest}`;
        const label = kind === 'compare' ? `${rest}` : `#${rest}`;
        return `<a href="${href}">${label}</a>`;
      });
      s = s.replace(/(^|[\s(])@([A-Za-z0-9-]+(?:\[bot\])?)/g, '$1<a href="https://github.com/$2">@$2</a>');
      s = s.replace(/(^|[\s,])([0-9a-f]{40})(?=$|[\s,])/g, (_m, pre: string, sha: string) => `${pre}<code>${sha.slice(0, 7)}</code>`);
      return s;
    })
    .join('');
}

/** Renders the markdown that toMarkdown produces. Everything is escaped first. */
export function markdownToHtml(md: string) {
  const html: string[] = [];
  let list = false;
  const closeList = () => {
    if (list) html.push('</ul>');
    list = false;
  };
  for (const line of md.split('\n')) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      html.push(`<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (!list) html.push('<ul>');
      list = true;
      html.push(`<li>${renderInline(line.replace(/^[-*]\s+/, ''))}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html.push(`<p>${renderInline(line)}</p>`);
    }
  }
  closeList();
  return html.join('\n');
}
