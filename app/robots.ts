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
        // /auth/ (Anmeldung, Konto, Riot-Anmeldung) hat nichts fuer den Index.
        allow: ['/', '/api/img/'],
        disallow: ['/api/', '/auth/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
