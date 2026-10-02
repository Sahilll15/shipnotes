'use client';

import { useEffect, useRef, useState } from 'react';
import { markdownToHtml } from '@/lib/markdown.ts';

export function ReleaseDrawer({
  markdown,
  repo,
  head,
  onClose,
}: {
  markdown: string;
  repo: string;
  head: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'preview' | 'markdown'>('preview');
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);

  const newRelease = `https://github.com/${repo}/releases/new?tag=${encodeURIComponent(head)}&title=${encodeURIComponent(head)}&body=${encodeURIComponent(markdown)}`;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="draft-title"
      className="m-auto w-[min(760px,calc(100vw-24px))] animate-pop rounded-2xl border border-line bg-white p-0 text-ink shadow-[0_30px_80px_-20px_rgba(15,17,21,0.45)] backdrop:bg-[rgba(15,17,21,0.35)] backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 id="draft-title" className="font-serif text-[22px] italic leading-none">
            Draft release body
          </h2>
          <p className="mt-1 text-[12px] text-ink-faint">How it will look on GitHub&apos;s release page.</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-wash hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="flex gap-1 border-b border-line px-5 pt-2" role="tablist">
        {(['preview', 'markdown'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 pb-2 pt-1 text-[13px] capitalize transition ${
              tab === t ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-faint hover:text-ink'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="max-h-[60vh] overflow-auto px-6 py-5">
        {tab === 'preview' ? (
          <div className="release-body text-[14px] leading-[1.6]" dangerouslySetInnerHTML={{ __html: markdownToHtml(markdown) }} />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.7] text-ink-soft">{markdown}</pre>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
        <p className="mr-auto text-[12px] text-ink-faint">Opening GitHub needs write access to the repo.</p>
        {newRelease.length < 7500 && (
          <a
            href={newRelease}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-line-strong px-4 py-2 text-[13px] font-medium transition hover:bg-wash"
          >
            Open in GitHub
          </a>
        )}
        <button
          onClick={() => navigator.clipboard.writeText(markdown)}
          className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white transition hover:bg-black active:scale-[0.98]"
        >
          Copy markdown
        </button>
      </div>
    </dialog>
  );
}
