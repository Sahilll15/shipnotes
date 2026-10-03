import Link from 'next/link';
import { breadcrumbs, pageMetadata } from '@/lib/seo.ts';
import { SAMPLES } from '../samples';
import { JsonLd } from '../ui/JsonLd';

export const metadata = pageMetadata({
  title: 'How ShipNotes writes release notes from GitHub commits',
  description:
    'How ShipNotes reads the commits and merged pull requests between two tags, groups them, writes each line for users and developers, checks every link, and what it keeps.',
  path: '/how-it-works',
});

const CATEGORIES: [string, string, string][] = [
  ['Breaking changes', 'breaking', 'Removes or changes behavior users depend on, so upgrading needs action.'],
  ['Features', 'features', 'A new capability.'],
  ['Improvements', 'improvements', 'Better behavior or performance of something that already existed.'],
  ['Fixes', 'fixes', 'Bug fixes.'],
  ['Docs', 'docs', 'Documentation only.'],
  ['Internal', 'internal', 'CI, tests, dependency bumps, refactors, release chores and tooling. Hidden unless you turn on the Internal switch.'],
];

const LIMITS: [string, string][] = [
  ['Commits per range', 'The newest 150 commits between the two refs are read. Older commits in a larger range are left out.'],
  ['Note runs', '4 new runs per IP address per hour. A range someone generated in the last hour comes back from cache and does not count.'],
  ['Tag lookups', '20 per IP address per hour.'],
  ['GitHub quota', 'The server shares one GitHub quota: 60 requests per hour without a token, 5,000 with one. When it runs out, ShipNotes stops calling GitHub and tells you when it resets.'],
  ['Prompt size', 'About 48,000 characters. PR descriptions start at 500 characters each and are shortened, then dropped, until the prompt fits. Titles are always kept.'],
  ['Model call', 'Low reasoning effort, up to two retries and a 90 second timeout.'],
  ['Request size', 'Request bodies over 2 KB are refused.'],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <h2 className="font-serif text-[30px] italic leading-none">{title}</h2>
      <div className="mt-4 space-y-3 text-[14.5px] leading-[1.7] text-ink-soft">{children}</div>
    </section>
  );
}

const code = 'rounded bg-wash px-1 font-mono text-[0.85em] text-ink';

export default function HowItWorksPage() {
  return (
    <div className="min-h-dvh">
      <JsonLd
        data={breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'How it works', path: '/how-it-works' },
        ])}
      />
      <header className="mx-auto flex max-w-[1080px] items-center justify-between px-4 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="8" fill="#0f1115" />
            <path d="M10 8v16" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
            <circle cx="10" cy="11" r="3" fill="#e5484d" />
            <path d="M15 11h8M15 17h6M15 23h7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          ShipNotes
        </Link>
        <Link href="/" className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-black">
          Write notes
        </Link>
      </header>

      <main className="mx-auto max-w-[760px] px-4 pb-24 pt-8 sm:px-8 sm:pt-14">
        <nav aria-label="Breadcrumb" className="font-mono text-[11.5px] text-ink-faint">
          <Link href="/" className="hover:text-ink">
            Home
          </Link>{' '}
          / <span className="text-ink-soft">How it works</span>
        </nav>
        <h1 className="mt-3 font-serif text-[38px] italic leading-[1] tracking-[-0.01em] sm:text-[48px]">
          How ShipNotes writes release notes from your GitHub commits
        </h1>
        <div className="mt-5 space-y-3 text-[15px] leading-[1.7] text-ink-soft">
          <p>
            ShipNotes is a free web tool that turns the commits and merged pull requests between two refs of a public GitHub repo into
            release notes. It groups the changes, writes each one as a single line for users and for developers, and links every line to
            the pull request or commit it came from.
          </p>
          <p>
            It works on public repos only, reads at most the newest 150 commits in a range, and allows 4 new runs per hour from one IP
            address. There is no sign-in.
          </p>
        </div>

        <Section title="The steps">
          <ol className="list-decimal space-y-3 pl-5 marker:font-mono marker:text-[12px] marker:text-ink-faint">
            <li>
              <strong className="font-semibold text-ink">Pick a repo and two refs.</strong> Enter <code className={code}>owner/repo</code> or a
              github.com URL. The server reads up to 40 of the repo&apos;s releases or tags and fills in the two newest stable ones when there are two. You can
              type any tag, branch name or commit SHA instead.
            </li>
            <li>
              <strong className="font-semibold text-ink">Fetch the commits.</strong> The server calls the GitHub REST compare endpoint for{' '}
              <code className={code}>base...head</code>. PR numbers come from squash commit subjects like{' '}
              <code className={code}>fix: x (#123)</code> and from merge commits, and every commit brought in by a merge is credited to that
              PR. PR titles, descriptions, labels and authors come from one GitHub search, with single PR lookups as a fallback. When the
              server has a GitHub token, commits with no PR number are also checked against GitHub&apos;s list of PRs for that commit.
            </li>
            <li>
              <strong className="font-semibold text-ink">Write the notes.</strong> One call to the OpenAI Responses API with Structured
              Outputs (<code className={code}>gpt-5.4-mini</code> by default) returns a headline, a summary and a list of bullets. Each
              bullet has a category, a line for users, a line for developers and the IDs of its sources. PR text is passed to the model as
              untrusted data, and the prompt tells it to ignore instructions inside it.
            </li>
            <li>
              <strong className="font-semibold text-ink">Check every citation.</strong> Code resolves each cited ID against the commits and
              PRs it fetched. Made up PR numbers and SHAs are dropped, a bullet left with no valid source is removed, and any change the model
              skipped is added back from its own title, with its category picked from conventional commit prefixes and labels. The result of
              these checks is shown under the notes.
            </li>
            <li>
              <strong className="font-semibold text-ink">Export.</strong> Copy the markdown, download it as a <code className={code}>.md</code>{' '}
              file, or open the draft release body, which renders the markdown the way a GitHub release page shows it.
            </li>
          </ol>
        </Section>

        <Section title="How changes are grouped">
          <p>Every bullet lands in one of six groups, shown in this order:</p>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-white">
            {CATEGORIES.map(([name, key, what]) => (
              <li key={key} className="flex gap-3 px-4 py-3">
                <span aria-hidden className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--color-${key})` }} />
                <span>
                  <span className="font-semibold text-ink">{name}.</span> {what}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="For users or for developers">
          <p>
            The same model call writes two versions of every line. <span className="text-ink">For users</span> describes what changed for
            someone using the library or app. <span className="text-ink">For developers</span> keeps the technical detail. The switch above
            the notes only picks which version to show, so changing it makes no new request, and the copied or downloaded markdown follows
            whichever version is selected.
          </p>
        </Section>

        <Section title="How each line links back">
          <p>
            In the page, each line shows the PR number or commit SHA it came from, linked to GitHub. In the markdown, lines follow
            GitHub&apos;s release format: <code className={code}>- line by @author in &lt;PR url&gt;</code>, or the commit SHA when there is no
            PR. GitHub turns both into links. The markdown ends with a contributors line, leaving out bots, and a Full Changelog link to the
            compare view for the range.
          </p>
        </Section>

        <Section title="Browser and server">
          <p>
            The browser sends only the repo name and the two refs. The server calls GitHub and OpenAI, so the OpenAI key and any GitHub token
            never reach the browser. Progress and the result stream back line by line. The tone switch, the Internal switch and the markdown
            are handled in the browser from that one result.
          </p>
        </Section>

        <Section title="Limits">
          <dl className="mt-2 divide-y divide-line rounded-xl border border-line bg-white">
            {LIMITS.map(([k, v]) => (
              <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[160px_1fr] sm:gap-4">
                <dt className="font-mono text-[12px] uppercase tracking-[0.06em] text-ink-faint sm:pt-[3px]">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="What is sent and what is kept">
          <p>
            OpenAI receives the repo name, the range, and for each change its title, labels, author login and a shortened PR description.
            Code diffs are not sent.
          </p>
          <p>
            GitHub responses are kept in server memory for 15 minutes and finished notes for one hour, so a repeat request for the same range
            is answered from memory. To enforce the hourly limits, Redis keeps a request count keyed by IP address, which expires with the
            hour. Repo names, refs and notes are not written to any database, there are no accounts, and the page saves nothing in your browser.
          </p>
        </Section>

        <Section title="Try a sample">
          <p>The home page has three sample ranges, each a pair of adjacent stable releases:</p>
          <ul className="list-disc space-y-1 pl-5">
            {SAMPLES.map((s) => (
              <li key={s.repo}>
                <span className="font-medium text-ink">{s.repo}</span>{' '}
                <span className="font-mono text-[12.5px]">
                  {s.base} to {s.head}
                </span>
                , {s.blurb[0].toLowerCase() + s.blurb.slice(1)}
              </li>
            ))}
          </ul>
          <p>
            <Link href="/" className="font-medium text-ink underline underline-offset-4 decoration-line-strong transition hover:decoration-ink">
              Open ShipNotes and write notes
            </Link>
          </p>
        </Section>
      </main>
    </div>
  );
}
