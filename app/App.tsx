'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseRepo, type TagInfo } from '@/lib/repo.ts';
import { toMarkdown, type Tone } from '@/lib/markdown.ts';
import type { NotesResult } from '@/server/generate.ts';
import { SAMPLES } from './samples';
import { Changelog } from './ui/Changelog';
import { RefPicker } from './ui/RefPicker';
import { ReleaseDrawer } from './ui/ReleaseDrawer';
import { EmptyState, ErrorState, LoadingState } from './ui/States';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; steps: string[] }
  | { kind: 'error'; message: string; code?: string }
  | { kind: 'done'; data: NotesResult };

type Quota = NotesResult['github'];

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#0f1115" />
        <path d="M10 8v16" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="10" cy="11" r="3" fill="#e5484d" />
        <path d="M15 11h8M15 17h6M15 23h7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      ShipNotes
    </Link>
  );
}

function IconButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-8 w-8 place-items-center rounded-full text-ink transition hover:bg-wash disabled:cursor-not-allowed disabled:text-line-strong disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

export function App() {
  const [repo, setRepo] = useState('');
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [tagsFor, setTagsFor] = useState('');
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagError, setTagError] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [tone, setTone] = useState<Tone>('user');
  const [showInternal, setShowInternal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [toast, setToast] = useState('');
  const [quota, setQuota] = useState<Quota | null>(null);
  const tagReq = useRef(0);
  const repoInput = useRef<HTMLInputElement>(null);

  const loadTags = useCallback(async (input: string, keepRefs = false) => {
    const id = parseRepo(input);
    if (!id) return;
    const full = `${id.owner}/${id.repo}`;
    const n = ++tagReq.current;
    setTagsLoading(true);
    setTagError('');
    try {
      const res = await fetch(`/api/refs?repo=${encodeURIComponent(full)}`);
      const json = await res.json();
      if (n !== tagReq.current) return;
      if (!res.ok) {
        setTags([]);
        setTagError(json.error ?? 'Could not load tags.');
        return;
      }
      setTags(json.tags);
      setTagsFor(full.toLowerCase());
      setQuota(json.github);
      if (!keepRefs && json.default) {
        setBase(json.default.base);
        setHead(json.default.head);
      }
      if (!json.tags.length) setTagError('No tags found. Type a branch name or commit SHA instead.');
    } catch {
      if (n === tagReq.current) setTagError('Could not reach the server.');
    } finally {
      if (n === tagReq.current) setTagsLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = parseRepo(repo);
    if (!id || `${id.owner}/${id.repo}`.toLowerCase() === tagsFor) return;
    const t = setTimeout(() => loadTags(repo), 650);
    return () => clearTimeout(t);
  }, [repo, tagsFor, loadTags]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const generate = useCallback(async (r: string, b: string, h: string) => {
    setStatus({ kind: 'loading', steps: ['Sending the request'] });
    setDrawer(false);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo: r, base: b.trim(), head: h.trim() }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        setStatus({ kind: 'error', message: json.error ?? `Request failed (${res.status}).`, code: json.code });
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === 'progress') setStatus((s) => ({ kind: 'loading', steps: [...(s.kind === 'loading' ? s.steps : []), ev.step] }));
          if (ev.type === 'error') setStatus({ kind: 'error', message: ev.message, code: ev.code });
          if (ev.type === 'result') {
            setStatus({ kind: 'done', data: ev.data });
            setQuota(ev.data.github);
          }
        }
      }
    } catch {
      setStatus({ kind: 'error', message: 'The connection dropped before the notes finished. Try again.' });
    }
  }, []);

  const runSample = (s: (typeof SAMPLES)[number]) => {
    setRepo(s.repo);
    setBase(s.base);
    setHead(s.head);
    loadTags(s.repo, true);
    generate(s.repo, s.base, s.head);
  };

  const parsed = parseRepo(repo);
  const canSubmit = Boolean(parsed && base.trim() && head.trim() && base.trim() !== head.trim()) && status.kind !== 'loading';
  const data = status.kind === 'done' ? status.data : null;
  const markdown = useMemo(() => (data ? toMarkdown(data, tone, showInternal) : ''), [data, tone, showInternal]);
  const internalCount = data ? data.bullets.filter((b) => b.category === 'internal').length : 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setToast('Markdown copied');
    } catch {
      setToast('Copy failed. Use the draft view instead.');
    }
  };
  const download = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `${data.repo.replace('/', '-')}-${data.head}.md`,
    });
    a.click();
    URL.revokeObjectURL(url);
  };

  const sampleButtons = (
    <div className="flex flex-wrap gap-2">
      {SAMPLES.map((s) => (
        <button
          key={s.repo}
          type="button"
          onClick={() => runSample(s)}
          disabled={status.kind === 'loading'}
          className="group rounded-full border border-line-strong bg-white py-1.5 pl-3 pr-3.5 text-left text-[12.5px] text-ink transition hover:-translate-y-px hover:border-ink hover:shadow-[0_6px_16px_-10px_rgba(15,17,21,0.5)] disabled:opacity-50 disabled:hover:translate-y-0"
        >
          <span className="font-medium">{s.repo}</span>{' '}
          <span className="font-mono text-[11.5px] text-ink-faint group-hover:text-ink-soft">
            {s.base} → {s.head}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1080px] items-center justify-between px-4 py-5 sm:px-8">
        <Logo />
        <div className="flex items-center gap-3">
          {quota?.core && (
            <span
              className="hidden rounded-full border border-line bg-white px-2.5 py-1 font-mono text-[11px] text-ink-faint sm:inline"
              title="GitHub API requests left this hour for this server"
            >
              GitHub {quota.core.remaining}/{quota.core.limit}
            </span>
          )}
          <a href="#how" className="text-[13px] text-ink-soft transition hover:text-ink">
            How it works
          </a>
          <button
            onClick={() => {
              repoInput.current?.focus();
              repoInput.current?.select();
            }}
            className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-black active:scale-[0.98]"
          >
            New notes
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1080px] px-4 pb-24 sm:px-8">
        <div className="mx-auto max-w-[760px] sm:pl-[136px]">
          <section className="pt-8 sm:pt-14">
            <div className="flex items-end justify-between gap-4">
              <h1 className="font-serif text-[46px] italic leading-[0.95] tracking-[-0.01em] sm:text-[54px]">Changelog</h1>
              <div className="flex items-center gap-0.5 pb-1">
                <IconButton label="Copy markdown" onClick={copy} disabled={!data}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                    <rect x="5" y="5" width="8.5" height="8.5" rx="2" />
                    <path d="M10.5 5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1H5" />
                  </svg>
                </IconButton>
                <IconButton label="Download markdown" onClick={download} disabled={!data}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
                    <path d="M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M3 13.5h10" />
                  </svg>
                </IconButton>
                <IconButton label="Draft release body" onClick={() => setDrawer(true)} disabled={!data}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                    <rect x="2.5" y="3" width="11" height="10" rx="2" />
                    <path d="M5 6.5h6M5 9.5h4" strokeLinecap="round" />
                  </svg>
                </IconButton>
              </div>
            </div>
            <p className="mt-3 text-[14px] text-ink-soft">
              Release notes people can read, written from the commits and pull requests between two refs.
            </p>

            <form
              className="mt-7 rounded-2xl border border-line bg-white/90 p-4 shadow-[0_1px_0_rgba(15,17,21,0.03),0_12px_40px_-24px_rgba(15,17,21,0.25)] backdrop-blur sm:p-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSubmit) generate(repo, base, head);
              }}
            >
              <label htmlFor="repo" className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
                Public GitHub repo
              </label>
              <div className="flex h-11 items-center rounded-xl border border-line-strong bg-white px-3 transition focus-within:border-ink focus-within:shadow-[0_0_0_3px_rgba(15,17,21,0.06)]">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="mr-2 shrink-0 text-ink-faint">
                  <path
                    fill="currentColor"
                    d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
                  />
                </svg>
                <input
                  ref={repoInput}
                  id="repo"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  onBlur={() => parseRepo(repo) && loadTags(repo, Boolean(base && head))}
                  placeholder="owner/repo or https://github.com/owner/repo"
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={200}
                  className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-faint"
                />
              </div>
              {repo && !parsed && <p className="mt-1.5 text-[12px] text-breaking">Use owner/repo, like pmndrs/zustand.</p>}
              {tagError && parsed && <p className="mt-1.5 text-[12px] text-docs">{tagError}</p>}

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <RefPicker label="From" value={base} onChange={setBase} tags={tags} loading={tagsLoading} />
                <span aria-hidden className="hidden h-11 items-center text-ink-faint sm:flex">
                  →
                </span>
                <RefPicker label="To" value={head} onChange={setHead} tags={tags} loading={tagsLoading} />
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="h-11 shrink-0 rounded-xl bg-ink px-5 text-[14px] font-medium text-white transition hover:bg-black active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-white"
                >
                  {status.kind === 'loading' ? 'Writing' : 'Write notes'}
                </button>
              </div>
            </form>

            {status.kind !== 'idle' && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-ink-faint">
                <span>Try a sample:</span>
                {sampleButtons}
              </div>
            )}
          </section>

          {data && (
            <div className="sticky top-0 z-20 -mx-4 mt-8 flex flex-wrap items-center gap-2 border-b border-line bg-white/85 px-4 py-2.5 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-2.5">
              <div role="radiogroup" aria-label="Tone" className="flex rounded-full bg-wash p-0.5">
                {(
                  [
                    ['user', 'For users'],
                    ['dev', 'For developers'],
                  ] as const
                ).map(([t, label]) => (
                  <button
                    key={t}
                    role="radio"
                    aria-checked={tone === t}
                    onClick={() => setTone(t)}
                    className={`rounded-full px-3 py-1 text-[12.5px] transition ${
                      tone === t ? 'bg-white font-medium text-ink shadow-[0_1px_3px_rgba(15,17,21,0.12)]' : 'text-ink-soft hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="flex cursor-pointer select-none items-center gap-2 rounded-full px-2 py-1 text-[12.5px] text-ink-soft hover:text-ink">
                <input
                  type="checkbox"
                  checked={showInternal}
                  onChange={(e) => setShowInternal(e.target.checked)}
                  className="peer sr-only"
                />
                <span className="relative h-4 w-7 rounded-full bg-line-strong transition peer-checked:bg-ink peer-focus-visible:outline-2 peer-focus-visible:outline-features after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-3" />
                Internal <span className="font-mono text-[11px] text-ink-faint">{internalCount}</span>
              </label>
              <div className="ml-auto flex gap-1.5">
                <button onClick={copy} className="rounded-full border border-line-strong bg-white px-3 py-1 text-[12.5px] font-medium transition hover:bg-wash">
                  Copy
                </button>
                <button onClick={download} className="rounded-full border border-line-strong bg-white px-3 py-1 text-[12.5px] font-medium transition hover:bg-wash">
                  .md
                </button>
                <button onClick={() => setDrawer(true)} className="rounded-full bg-ink px-3 py-1 text-[12.5px] font-medium text-white transition hover:bg-black">
                  Release body
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mx-auto mt-10 max-w-[760px]">
          {status.kind === 'idle' && <EmptyState>{sampleButtons}</EmptyState>}
          {status.kind === 'loading' && <LoadingState steps={status.steps} />}
          {status.kind === 'error' && (
            <ErrorState message={status.message} code={status.code} onRetry={() => canSubmit && generate(repo, base, head)} />
          )}
          {data && <Changelog data={data} tone={tone} showInternal={showInternal} />}
        </div>

        <section id="how" className="mx-auto mt-24 max-w-[760px] scroll-mt-8 sm:pl-[136px]">
          <h2 className="font-serif text-[32px] italic leading-none">How it works</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            {[
              ['Fetch', 'The server reads the compare range from the GitHub REST API, then the merged PRs behind each commit. Responses are cached in memory and the range is capped at 150 commits.'],
              ['Write', 'One OpenAI Structured Outputs call groups the changes and writes every line twice: once for users, once for developers.'],
              ['Verify', 'Code checks each cited PR and commit against the fetched set. Made-up references are dropped, and anything the model skipped is added back from its title.'],
            ].map(([t, d]) => (
              <div key={t}>
                <h3 className="text-[14px] font-semibold">{t}</h3>
                <p className="mt-1.5 text-[13px] leading-[1.65] text-ink-soft">{d}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 text-[12px] text-ink-faint">
            Public repos only. Nothing you enter is stored beyond a short in-memory cache.
          </p>
        </section>
      </main>

      {drawer && data && <ReleaseDrawer markdown={markdown} repo={data.repo} head={data.head} onClose={() => setDrawer(false)} />}

      <div
        aria-live="polite"
        className={`pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[13px] text-white shadow-lg transition duration-200 ${
          toast ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
        }`}
      >
        {toast}
      </div>
    </div>
  );
}
