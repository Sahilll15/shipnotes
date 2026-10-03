import type { MetadataRoute } from 'next';

const base = 'https://shipnotes-mu.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${base}/`, changeFrequency: 'monthly', priority: 1 },
  ];
}
