import { cache } from 'react';
import { compDetailStart } from '../../../lib/seo/comp-detail-data';
import { toSearchParams } from '../../../lib/seo/initial-data';
import { pageMetadata } from '../../../lib/seo/metadata';
import { tftKnownInBundle } from '../../../lib/seo/names';
import { decodeSlug } from '../../../lib/og/slugs';
import { compNameFromSlug, tftAssets } from '../../../lib/og/data';
import { compCanonicalKey, compPath, compRouteKey } from '../../../lib/tft-comp-path';
import { compKeyForDefaultView } from '../../../lib/tft-comp-catalog-resolver';
import { compHeadingText, type HeadingComp } from '../../../lib/tft-comp-heading';
import { CURRENT_SET } from '../../../lib/current-set';
import type { Lang } from '../../../lib/lang-path';
import CompDetailClient from './CompDetailClient';

// Server-Huelle der Comp-Detailseite (SEO-Plan Schritt 5b): Name, Zahlen und
// Links kommen mit dem ersten HTML, die Seite selbst bleibt die
// Client-Komponente von vorher. Ohne vorgerechneten Stand (oder nach 1,5 s)
// laedt sie wie bisher im Browser.
//
// Der Pfadteil ist ein lesbarer Name (/tft/comps/lunar-aphelios → Familien-
// Kennung, tft-comp-path.ts) oder eine Kennung; die Seite bekommt die interne
// Kennung als Prop. key={routeKey}: ein Wechsel auf eine andere Comp (Gegner)
// baut die Seite mit deren Startdaten neu auf, statt die alte stehen zu lassen.

// Startdaten je Anfrage nur einmal lesen: Titel (Standardansicht) und Seite
// ohne Filter in der Adresse fragen dasselbe ab. cache() vergleicht die
// Argumente nach Identitaet — deshalb die Abfrage als Text, nie URLSearchParams.
const startFor = cache((routeKey: string, query: string) => compDetailStart(routeKey, new URLSearchParams(query)));

function headingComp(value: unknown): HeadingComp | null {
  const c = value as Partial<HeadingComp> | null | undefined;
  return c && typeof c.clusterKey === 'string' && typeof c.games === 'number' ? (c as HeadingComp) : null;
}

// Titel + canonical (bis 09.11.2026 in layout.tsx). canonical und noindex aus
// der Katalog-Zuordnung (hoechstens 400 ms), nie aus den Startdaten — die
// fehlen bei Zeitlimit, grossem Stand oder ?variant=exact. Der NAME kommt aus
// den Startdaten der Standardansicht mit derselben Regel wie die Ueberschrift
// (compHeadingText), sonst Trait + Schluessel-Carry aus der Kennung. Fuer
// Googlebot wartet der Kopf darauf (htmlLimitedBots, next.config.ts), Besucher
// bekommen ihn nachgestreamt.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const key = compRouteKey(decodeSlug((await params).slug));
  const [comp, start] = await Promise.all([compKeyForDefaultView(key, CURRENT_SET), startFor(key, '')]);
  const shown = compCanonicalKey(key, comp);
  const heading = headingComp(start?.detail.comp);
  const bundle = tftAssets();
  const name = (lang: Lang) =>
    (heading ? compHeadingText(heading, bundle, lang) : null) || compNameFromSlug(shown, lang) || shown;
  return pageMetadata('tft.comp', compPath(shown), name, {
    noindex: tftKnownInBundle('comp', key) === false || comp === null,
  });
}

export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const routeKey = compRouteKey(decodeSlug((await params).slug));
  const initial = await startFor(routeKey, toSearchParams(await searchParams).toString());
  return <CompDetailClient key={routeKey} routeKey={routeKey} initial={initial} />;
}
