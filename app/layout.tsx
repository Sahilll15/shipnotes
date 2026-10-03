import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { APP_ID, PERSON_ID, SITE_URL, WEBSITE_ID } from '@/lib/seo.ts';
import { JsonLd } from './ui/JsonLd';
import { SiteFooter } from './ui/SiteFooter';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });
const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

const siteUrl = SITE_URL;
const title = 'ShipNotes: release notes from your GitHub commits';
const description =
  'Paste a public GitHub repo, pick two tags, and get grouped release notes for users or developers, with every line linked to its pull request or commit.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  alternates: { canonical: '/' },
  title: { default: title, template: '%s | ShipNotes' },
  description,
  keywords: ['release notes generator', 'changelog generator', 'GitHub release notes', 'changelog from commits', 'release notes from pull requests', 'git tag changelog', 'automatic changelog'],
  applicationName: 'ShipNotes',
  authors: [{ name: 'Sahil Chalke', url: 'https://sahilchalke.com' }],
  creator: 'Sahil Chalke',
  openGraph: { type: 'website', siteName: 'ShipNotes', title, description, url: '/', locale: 'en_US' },
  twitter: { card: 'summary_large_image', creator: '@chalke1015', title, description },
  robots: { index: true, follow: true },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': WEBSITE_ID,
      name: 'ShipNotes',
      url: siteUrl,
      description,
      inLanguage: 'en',
      publisher: { '@id': PERSON_ID },
      author: { '@id': PERSON_ID },
    },
    {
      '@type': 'WebApplication',
      '@id': APP_ID,
      name: 'ShipNotes',
      url: siteUrl,
      description,
      isPartOf: { '@id': WEBSITE_ID },
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Web',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      screenshot: `${siteUrl}/opengraph-image.png`,
      featureList: [
        'Release notes from the commits and merged pull requests between two tags of a public GitHub repo',
        'Changes grouped into breaking changes, features, improvements, fixes, docs and internal work',
        'Every line written for users and for developers',
        'Every line linked to its pull request or commit',
        'Markdown export in the GitHub release format',
      ],
      author: { '@id': PERSON_ID },
    },
    {
      '@type': 'Person',
      '@id': PERSON_ID,
      name: 'Sahil Chalke',
      url: 'https://sahilchalke.com',
      sameAs: ['https://github.com/Sahilll15', 'https://x.com/chalke1015'],
    },
  ],
};

export const viewport: Viewport = { themeColor: '#ffffff' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <JsonLd data={jsonLd} />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
