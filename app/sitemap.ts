import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo.ts';

// Bump a date only when that page's content changes.
const UPDATED = { home: '2026-10-04', howItWorks: '2026-10-04' };

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, lastModified: UPDATED.home, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/how-it-works`, lastModified: UPDATED.howItWorks, changeFrequency: 'monthly', priority: 0.7 },
  ];
}
