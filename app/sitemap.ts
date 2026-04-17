import type { MetadataRoute } from 'next';

// Rebuild sitemap at most once per day
export const revalidate = 86400;

const SITE_URL = 'https://metastats.gg';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes = [
    { path: '/', priority: 1.0, changeFrequency: 'daily' as const },
    { path: '/leaderboard', priority: 0.9, changeFrequency: 'hourly' as const },
    { path: '/champions', priority: 0.8, changeFrequency: 'daily' as const },
    { path: '/marktwert', priority: 0.8, changeFrequency: 'hourly' as const },
    { path: '/teams', priority: 0.7, changeFrequency: 'daily' as const },
    { path: '/ligen', priority: 0.7, changeFrequency: 'daily' as const },
    { path: '/compare', priority: 0.6, changeFrequency: 'weekly' as const },
    { path: '/multi-search', priority: 0.5, changeFrequency: 'weekly' as const },
  ];
  return routes.map(r => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
