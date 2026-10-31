// Die drei festen Vorschaubilder (Startseite/LoL, TFT, TFT-Marktwerte) je Sprache,
// 18 Stueck, beim Bauen erzeugt. Die Sprache steht im Pfad, weil Next die Adresse
// eines opengraph-image aus dem Ordner bildet (auch /en/tft/comps nennt
// /tft/opengraph-image) und der Bildfunktion keine Abfrage durchreicht.
//
// Beim Bauen statt zur Laufzeit: Koreanisch und Chinesisch laedt next/og von
// fonts.googleapis.com. Ein Fehlbild wegen eines Schriftabrufs laege sonst bis zu
// einem Tag im Zwischenspeicher.
import { ImageResponse } from 'next/og';
import { ACCENT_LOL, ACCENT_TFT, OG_CACHE_HEADERS, OG_SIZE, StaticCard } from '../../../lib/og/frame';
import { CARD_COPY, OG_CARDS, OG_LANGS, isOgCard, isOgLang } from '../../../lib/og/card-copy';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return OG_LANGS.flatMap(lang => OG_CARDS.map(card => ({ lang, card })));
}

export async function GET(_req: Request, { params }: { params: Promise<{ lang: string; card: string }> }) {
  const { lang, card } = await params;
  if (!isOgLang(lang) || !isOgCard(card)) return new Response('Not Found', { status: 404 });

  const headers = { ...OG_SIZE, headers: OG_CACHE_HEADERS };
  if (card === 'marktwert') {
    const text = CARD_COPY[lang].marktwert;
    // Lange Titel (es, fr) muessen in die Zeile passen; der deutsche bleibt bei 128.
    const titleSize = Math.min(128, Math.floor(2000 / (text.word.length + 4)));
    return new ImageResponse(
      <StaticCard
        accent={ACCENT_TFT}
        titleSize={titleSize}
        title={<>TFT <span style={{ color: ACCENT_TFT, marginLeft: Math.round(titleSize / 6.4) }}>{text.word}</span></>}
        subtitle={text.subtitle}
        pills={text.pills}
      />,
      headers,
    );
  }
  const accent = card === 'tft' ? ACCENT_TFT : ACCENT_LOL;
  const text = CARD_COPY[lang][card];
  return new ImageResponse(
    <StaticCard
      accent={accent}
      title={<>meta<span style={{ color: accent }}>stats</span>.gg</>}
      subtitle={text.subtitle}
      pills={text.pills}
    />,
    headers,
  );
}
