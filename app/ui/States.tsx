import { Entry } from './Changelog';

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <ol className="mt-2" aria-label="Changelog preview">
      <Entry label="Your release" color="var(--color-line-strong)">
        <p className="text-[15px] font-semibold">Your changelog shows up here</p>
        <p className="mt-1 max-w-[52ch] text-[14px] leading-[1.65] text-ink-soft">
          ShipNotes reads the commits and merged pull requests between two refs, sorts them into breaking changes,
          features, improvements, fixes and docs, and links every line back to its source.
        </p>
        <div className="mt-4">{children}</div>
      </Entry>
      {['features', 'fixes'].map((c, i) => (
        <Entry key={c} label={<span className="opacity-50">{c === 'features' ? 'Features' : 'Fixes'}</span>} color={`var(--color-${c})`} last={i === 1}>
          <div className="space-y-2.5 opacity-60" aria-hidden>
            <div className="h-3 w-24 rounded bg-line" />
            <div className="h-2.5 w-[78%] rounded bg-line" />
            <div className="h-2.5 w-[62%] rounded bg-line" />
          </div>
        </Entry>
      ))}
    </ol>
  );
}

export function LoadingState({ steps }: { steps: string[] }) {
  return (
    <ol className="mt-2" aria-live="polite" aria-busy="true">
      <Entry label="Working" color="var(--color-features)">
        <ul className="space-y-1.5 text-[13.5px]">
          {steps.map((s, i) => {
            const done = i < steps.length - 1;
            return (
              <li key={s} className="flex animate-rise items-center gap-2.5">
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="text-fixes">
                    <path d="M3 7.5 5.8 10 11 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-features" />
                )}
                <span className={done ? 'text-ink-faint' : 'text-ink'}>{s}</span>
              </li>
            );
          })}
        </ul>
      </Entry>
      {[0, 1].map((i) => (
        <Entry key={i} label={<span className="skeleton inline-block h-3 w-16" />} color="var(--color-line-strong)" last={i === 1}>
          <div className="space-y-2.5">
            <div className="skeleton h-3.5 w-28" />
            <div className="skeleton h-3 w-[82%]" />
            <div className="skeleton h-3 w-[70%]" />
            <div className="skeleton h-3 w-[58%]" />
          </div>
        </Entry>
      ))}
    </ol>
  );
}

export function ErrorState({ message, code, onRetry }: { message: string; code?: string; onRetry: () => void }) {
  const title =
    code === 'rate_limited' ? 'Slow down a little' : code === 'not_found' ? 'Nothing found there' : 'That did not work';
  return (
    <ol className="mt-2" role="alert">
      <Entry label="Error" color="var(--color-breaking)" last>
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="mt-1 max-w-[56ch] text-[14px] leading-[1.65] text-ink-soft">{message}</p>
        <button
          onClick={onRetry}
          className="mt-4 rounded-full border border-line-strong bg-white px-4 py-1.5 text-[13px] font-medium transition hover:bg-wash"
        >
          Try again
        </button>
      </Entry>
    </ol>
  );
}
