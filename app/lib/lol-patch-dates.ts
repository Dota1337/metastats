// Echte Erscheinungsdaten der LoL-Patch-Notes aus Riots Uebersichtsseite
// (leagueoflegends.com/en-us/news/tags/patch-notes/, __NEXT_DATA__).
// Zuordnung ueber den Titel „Patch 26.19 Notes“, nicht ueber die Adresse:
// Riot hat drei Adress-Formen (league-of-legends-patch-26-4-notes,
// patch-26-3-notes, patch-25-04-notes).

export interface PatchArticle { date: string; url: string }

const TITLE = /Patch (\d+)\.(\d+) Notes/;

/** HTML der Uebersichtsseite -> Map 'JJ.P' -> { date: 'YYYY-MM-DD' (UTC), url }. */
export function parsePatchArticles(html: string): Map<string, PatchArticle> {
  const out = new Map<string, PatchArticle>();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return out;
  let data: unknown;
  try { data = JSON.parse(m[1]); } catch { return out; }
  const walk = (o: unknown) => {
    if (!o || typeof o !== 'object') return;
    const rec = o as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title : null;
    const published = typeof rec.publishedAt === 'string' ? rec.publishedAt : null;
    const url = (rec.action as { payload?: { url?: unknown } } | undefined)?.payload?.url;
    const t = title?.match(TITLE);
    if (t && published && /^\d{4}-\d{2}-\d{2}T/.test(published) && typeof url === 'string' && url.startsWith('/')) {
      const key = `${parseInt(t[1], 10)}.${parseInt(t[2], 10)}`;
      if (!out.has(key)) out.set(key, { date: published.slice(0, 10), url: `https://www.leagueoflegends.com${url}` });
    }
    for (const v of Object.values(rec)) walk(v);
  };
  walk(data);
  return out;
}
