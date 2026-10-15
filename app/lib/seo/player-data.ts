import 'server-only';
// Kopf der Spielerseiten (SEO-Plan Schritt 7): Titel, noindex und der Name als
// h1 im ersten HTML — aus unseren Quellen, nie von Riot (player-lookup-server.ts).
// React.cache mit einfachen Argumenten: Layout (Titel, noindex) und Huelle
// (Kopf) teilen sich je Aufruf eine Abfrage. Notschalter SEO_START_DATA=0
// schaltet Kopf UND noindex ab.
import { cache } from 'react';
import { lolPlayerLookup, tftDirectoryLookup } from '../player-lookup-server';
import { toHead, type PlayerHead } from '../player-lookup';

const off = () => process.env.SEO_START_DATA === '0';

export const tftPlayerHead = cache(async (gameName: string, tagLine: string): Promise<PlayerHead> => {
  if (off()) return null;
  const r = await tftDirectoryLookup(gameName, tagLine);
  return toHead(r && (r.known ? { known: true, value: { gameName: r.value.gameName, tagLine: r.value.tagLine } } : r));
});

export const lolPlayerHead = cache(async (name: string, tag: string): Promise<PlayerHead> => {
  if (off()) return null;
  return toHead(await lolPlayerLookup(name, tag));
});

/** Name fuer den Seitentitel: Schreibweise der Quelle, sonst die aus der Adresse. */
export function headTitle(head: PlayerHead, gameName: string, tagLine: string): string {
  if (head?.known) return `${head.gameName}#${head.tagLine}`;
  return `${gameName}${tagLine ? '#' + tagLine : ''}`;
}
