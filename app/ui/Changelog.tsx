import type { ReactNode } from 'react';
import { CATEGORY_LABEL, groupBullets, type Bullet, type Category } from '@/lib/notes.ts';
import type { Tone } from '@/lib/markdown.ts';
import type { NotesResult } from '@/server/generate.ts';
import { Avatar } from './Avatar';

export const catColor = (c: Category) => `var(--color-${c})`;

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export function Entry({
  label,
  color,
  children,
  delay = 0,
  last = false,
}: {
  label: ReactNode;
  color: string;
  children: ReactNode;
  delay?: number;
  last?: boolean;
}) {
  return (
    <li className="grid animate-rise grid-cols-1 sm:grid-cols-[112px_1fr] sm:gap-x-6" style={{ animationDelay: `${delay}ms` }}>
      <div className="hidden pt-[3px] text-right text-[12px] font-medium sm:block" style={{ color }}>
        {label}
      </div>
      <div className={`relative border-l border-line pl-6 sm:pl-7 ${last ? 'pb-2' : 'pb-11'}`}>
        <span
          aria-hidden
          className="absolute -left-[4.5px] top-[8px] h-2 w-2 rounded-full ring-4 ring-white"
          style={{ background: color }}
        />
        <div className="mb-1 text-[12px] font-medium sm:hidden" style={{ color }}>
          {label}
        </div>
        {children}
      </div>
    </li>
  );
}

function RefChip({ id, data }: { id: string; data: NotesResult }) {
  const c = data.changes[id];
  if (!c) return null;
  return (
    <a
      href={c.url}
      target="_blank"
      rel="noreferrer"
      title={`${c.title}${c.author ? ` by ${c.author.login}` : ''}`}
      className="inline-flex items-center gap-1 rounded-full border border-line bg-white py-[1px] pl-[2px] pr-2 align-[1px] font-mono text-[11px] text-ink-soft transition hover:border-line-strong hover:text-ink"
    >
      <Avatar person={c.author} size={14} />
      {c.kind === 'pr' ? `#${c.number}` : c.id}
    </a>
  );
}

function Inline({ text }: { text: string }) {
  return (
    <span>
      {text.split(/(`[^`]+`)/g).map((p, i) =>
        /^`[^`]+`$/.test(p) ? (
          <code key={i} className="rounded bg-wash px-1 py-[1px] font-mono text-[0.9em]">
            {p.slice(1, -1)}
          </code>
        ) : (
          p
        ),
      )}
    </span>
  );
}

function BulletItem({ b, tone, data }: { b: Bullet; tone: Tone; data: NotesResult }) {
  return (
    <li className="relative pl-4 text-[14px] leading-[1.65] text-ink before:absolute before:left-0 before:top-[0.72em] before:h-[3px] before:w-[3px] before:rounded-full before:bg-ink">
      <Inline text={b[tone]} />{' '}
      <span className="inline-flex flex-wrap gap-1 align-middle">
        {b.refs.map((id) => (
          <RefChip key={id} id={id} data={data} />
        ))}
        {b.fallback && (
          <span
            title="The model left this change out, so ShipNotes added it from its title."
            className="rounded-full bg-wash px-2 py-[1px] text-[11px] text-ink-faint"
          >
            from title
          </span>
        )}
      </span>
    </li>
  );
}

export function Changelog({ data, tone, showInternal }: { data: NotesResult; tone: Tone; showInternal: boolean }) {
  const groups = groupBullets(data.bullets, showInternal);
  const prs = Object.values(data.changes).filter((c) => c.kind === 'pr').length;
  const people = data.contributors.filter((p) => !p.bot);
  const v = data.verification;
  const invented = v.invalidRefs.length;

  return (
    <ol className="mt-2">
      <Entry label={fmtDate(data.range.headDate)} color="var(--color-breaking)">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{data.headline}</h2>
        <p className="mt-1 font-mono text-[12px] text-ink-faint">
          <a className="hover:text-ink" href={`https://github.com/${data.repo}/compare/${data.base}...${data.head}`} target="_blank" rel="noreferrer">
            {data.base} → {data.head}
          </a>
          {' · '}
          {data.range.analyzedCommits} commits · {prs} PRs
        </p>
        <p className="mt-3 max-w-[56ch] text-[14px] leading-[1.65] text-ink-soft">
          <Inline text={data.summary[tone]} />
        </p>
        {data.range.truncated && (
          <p className="mt-3 rounded-lg bg-wash px-3 py-2 text-[12.5px] text-ink-soft">
            This range has {data.range.totalCommits} commits. ShipNotes read the newest {data.range.analyzedCommits}.
          </p>
        )}
        {people.length > 0 && (
          <div className="mt-4 flex items-center gap-2.5">
            <div className="flex -space-x-1.5">
              {people.slice(0, 10).map((p) => (
                <a key={p.login} href={p.url} target="_blank" rel="noreferrer" title={p.login} className="transition hover:-translate-y-0.5">
                  <Avatar person={p} size={24} ring />
                </a>
              ))}
            </div>
            <span className="text-[12px] text-ink-faint">
              {people.length} contributor{people.length === 1 ? '' : 's'}
              {people.length > 10 ? `, showing 10` : ''}
            </span>
          </div>
        )}
      </Entry>

      {groups.map((g, i) => (
        <Entry
          key={g.category}
          delay={80 + i * 60}
          color={catColor(g.category)}
          label={
            <>
              {CATEGORY_LABEL[g.category]} <span className="opacity-60">{g.bullets.length}</span>
            </>
          }
        >
          <h3 className="text-[14px] font-semibold">{CATEGORY_LABEL[g.category]}:</h3>
          <ul className="mt-2 space-y-1.5">
            {g.bullets.map((b) => (
              <BulletItem key={b.refs.join()} b={b} tone={tone} data={data} />
            ))}
          </ul>
        </Entry>
      ))}

      <Entry label="Checks" color="var(--color-ink-faint)" delay={80 + groups.length * 60} last>
        <h3 className="text-[14px] font-semibold">Citations checked:</h3>
        <ul className="mt-2 space-y-1 text-[13px] leading-[1.6] text-ink-soft">
          <li>
            Every bullet cites a PR or commit from this range. {Object.keys(data.changes).length} changes,{' '}
            {v.citations + v.uncovered.length} cited.
          </li>
          <li>
            {invented === 0
              ? 'The model cited no PRs or commits outside the range.'
              : `Dropped ${invented} reference${invented === 1 ? '' : 's'} the model made up: ${v.invalidRefs.slice(0, 6).join(', ')}.`}
            {v.droppedBullets > 0 && ` Removed ${v.droppedBullets} bullet${v.droppedBullets === 1 ? '' : 's'} left with no valid source.`}
          </li>
          {v.duplicateRefs.length > 0 && (
            <li>Cited in more than one bullet: {v.duplicateRefs.join(', ')}.</li>
          )}
          {v.uncovered.length > 0 && (
            <li>
              {v.uncovered.length} change{v.uncovered.length === 1 ? ' was' : 's were'} skipped by the model and added
              from {v.uncovered.length === 1 ? 'its title' : 'their titles'}.
            </li>
          )}
          {data.range.prDetails.missing > 0 && (
            <li>{data.range.prDetails.missing} PRs were summarized from commit messages only.</li>
          )}
          <li className="font-mono text-[11.5px] text-ink-faint">
            {data.usage.model} · {data.usage.inputTokens.toLocaleString()} in / {data.usage.outputTokens.toLocaleString()} out · $
            {data.usage.costUsd.toFixed(4)} · {(data.usage.ms / 1000).toFixed(1)}s{data.cached ? ' · cached' : ''}
          </li>
        </ul>
      </Entry>
    </ol>
  );
}
