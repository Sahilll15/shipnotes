import Link from 'next/link';
import { REPO_URL } from '@/lib/seo.ts';

const TOOLS = [
  { name: 'Interview Coach', url: 'https://interview-coach-seven-rose.vercel.app', what: 'AI mock interview practice' },
  { name: 'Minutes', url: 'https://minutes-sand.vercel.app', what: 'meeting minutes from audio' },
  { name: 'SplitSnap', url: 'https://splitsnap-sandy.vercel.app', what: 'split a bill from a receipt photo' },
  { name: 'AskCSV', url: 'https://askcsv-seven.vercel.app', what: 'ask questions about a CSV' },
  { name: 'ToneRadar', url: 'https://toneradar.vercel.app', what: 'check the tone of a message' },
  { name: 'Headline Arena', url: 'https://headline-arena-gamma.vercel.app', what: 'test and rank headlines' },
  { name: 'FinePrint', url: 'https://fineprint-beta.vercel.app', what: 'find risky clauses in contracts' },
  { name: 'fallacy finder', url: 'https://fallacy-finder-nine.vercel.app', what: 'spot logical fallacies' },
  { name: 'PitchPanel', url: 'https://pitchpanel.vercel.app', what: 'startup pitch feedback' },
  { name: 'Ask India', url: 'https://askindia.online', what: 'answers from official government sites' },
];

const link = 'text-ink underline-offset-4 transition hover:underline';

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white/80">
      <div className="mx-auto max-w-[1080px] px-4 py-8 text-[12.5px] leading-[1.6] text-ink-soft sm:px-8">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span>
            Built by{' '}
            <a href="https://sahilchalke.com" className={link}>
              Sahil Chalke
            </a>
          </span>
          <a href={REPO_URL} className={link}>
            Source code
          </a>
          <Link href="/how-it-works" className={link}>
            How it works
          </Link>
        </div>
        <p className="mt-2 max-w-[80ch]">
          The repo and refs you enter go to the server, which reads public commits from GitHub and sends their text to OpenAI.
          Finished notes stay in server memory for up to an hour, and Redis keeps only a per-IP request count.
        </p>
        <nav aria-label="More tools" className="mt-5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">More tools</h2>
          <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {TOOLS.map((t) => (
              <li key={t.url}>
                <a href={t.url} className={link}>
                  {t.name}
                </a>
                <span className="text-ink-faint">, {t.what}</span>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
