import type { Metadata } from 'next';

export const SITE_URL = 'https://shipnotes-mu.vercel.app';
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const APP_ID = `${SITE_URL}/#app`;
export const PERSON_ID = 'https://sahilchalke.com/#person';
export const REPO_URL = 'https://github.com/Sahilll15/shipnotes';
const ogImageAlt = 'ShipNotes release notes grouped into features, improvements and fixes, each line linked to a pull request';

/** Page metadata with matching canonical, Open Graph and Twitter fields. */
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  const fullTitle = `${title} | ShipNotes`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: 'ShipNotes',
      title: fullTitle,
      description,
      url: path,
      locale: 'en_US',
      images: [{ url: '/opengraph-image.png', width: 1200, height: 630, alt: ogImageAlt }],
    },
    twitter: {
      card: 'summary_large_image',
      creator: '@chalke1015',
      title: fullTitle,
      description,
      images: [{ url: '/twitter-image.png', alt: ogImageAlt }],
    },
  };
}

export function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: `${SITE_URL}${it.path}` })),
  };
}
