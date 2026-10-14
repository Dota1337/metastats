import type { MetadataRoute } from 'next';
import { SITE_URL } from './lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // /api/img/ ist der Bild-Proxy (Unit-, Item-, Trait-Bilder). Ohne die
        // Ausnahme sperrt /api/ auch die Bilder, und Google sieht die Seiten
        // ohne sie. Die laengere Regel gewinnt, der Rest von /api/ bleibt zu.
        allow: ['/', '/api/img/'],
        disallow: ['/api/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
