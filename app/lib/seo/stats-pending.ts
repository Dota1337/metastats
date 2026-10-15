// Gespeicherte Filter auf den Statistik-Listen (SEO-Plan E3).
//
// Die Server-Seite rendert die Standardansicht mit Zahlen (fuer Google). Wer
// eigene Filter gespeichert hat (localStorage, z. B. EUW + 7 Tage), soll diese
// fremden Zahlen nie sehen, sondern wie bisher die Ladeanzeige, bis seine
// eigenen da sind. Der Server kennt localStorage nicht — deshalb entscheidet
// ein kleines Skript im <head> VOR dem ersten Zeichnen und setzt ein Merkmal
// an <html>; das <style> der Seite blendet damit die Zeilen aus und die
// Ladeanzeige ein. Nach der Hydration uebernimmt React (Merkmal wird im
// useLayoutEffect entfernt, siehe UnitsClient.tsx).
//
// Das Skript steht im Wurzel-Layout: es laeuft genau einmal, beim ersten
// Dokument. Bei einer Navigation innerhalb der Seite entscheidet React allein,
// ebenfalls vor dem Zeichnen. Im Zweifel setzt es das Merkmal (kurz
// Ladeanzeige bis zur Hydration), es darf aber nie eines auslassen, das zu
// anderen Zahlen fuehrt — stats-pending.test.mjs prueft das gegen
// loadInitialFilters.
//
// Gleiche Regeln wie loadInitialFilters in app/lib/tft-filters.ts.
import {
  FILTERS_STORAGE_KEY, URL_FILTER_KEYS, VELOCITY_SHIFTS, FILTER_DEFAULTS, DAYS_MIN, DAYS_MAX,
} from '../tft-filters';
import { PREFIX_LANGS } from '../lang-path';

export const PENDING_ATTR = 'data-tft-pending';
// Ausdruecklich gewaehlter Rang aus dem Speicher; das <style> vergleicht ihn
// mit dem Rang, den der Server gerendert hat.
export const USER_BUCKET_ATTR = 'data-tft-ub';
// Notausgang: laeuft React nicht an, stehen nach 8 s die Server-Zahlen da
// statt einer ewigen Ladeanzeige.
const RELEASE_MS = 8000;

// Seiten mit Server-Startdaten (Comp-Liste seit Schritt 4), auch unter den
// Sprach-Adressen (/en/tft/units).
const PATHS = new RegExp(`^(?:/(?:${PREFIX_LANGS.join('|')}))?/tft/(?:units|items|traits|comps)/?$`);

export const STATS_PENDING_SCRIPT = `(function(){try{
var d=document.documentElement;
if(!${PATHS}.test(location.pathname))return;
var s=new URLSearchParams(location.search),k=${JSON.stringify(URL_FILTER_KEYS)};
for(var i=0;i<k.length;i++)if(s.has(k[i]))return;
var f=JSON.parse(localStorage.getItem(${JSON.stringify(FILTERS_STORAGE_KEY)})||'null');
if(!f||typeof f!=='object')return;
var dn=Number(f.days),days=isFinite(dn)?Math.max(${DAYS_MIN},Math.min(${DAYS_MAX},dn)):${FILTER_DEFAULTS.days},v=Number(f.velocity);
var other=(typeof f.patch==='string'&&f.patch!==${JSON.stringify(FILTER_DEFAULTS.patch)})||days!==${FILTER_DEFAULTS.days}
||(typeof f.region==='string'&&f.region!==${JSON.stringify(FILTER_DEFAULTS.region)})
||(${JSON.stringify(VELOCITY_SHIFTS.filter(s => s > 0))}.indexOf(v)>=0);
if(other)d.setAttribute('${PENDING_ATTR}','1');
else if(f.bucketAuto===false&&typeof f.bucket==='string')d.setAttribute('${USER_BUCKET_ATTR}',f.bucket);
else return;
setTimeout(function(){d.removeAttribute('${PENDING_ATTR}');d.removeAttribute('${USER_BUCKET_ATTR}');},${RELEASE_MS});
}catch(e){}})();`.replace(/\n/g, '');

const SAFE_BUCKET = /^[a-z_]+$/;

/** CSS fuer das <style> der Seite. `renderedBucket`: der Rang der Server-
 *  Zahlen, wenn er automatisch gewaehlt wurde (sonst null — dann stand ein
 *  Filter in der Adresse, und das Skript setzt kein Merkmal). */
export function statsPendingCss(renderedBucket: string | null): string {
  const hidden: string[] = [`html[${PENDING_ATTR}]`];
  if (renderedBucket && SAFE_BUCKET.test(renderedBucket)) {
    hidden.push(`html[${USER_BUCKET_ATTR}]:not([${USER_BUCKET_ATTR}="${renderedBucket}"])`);
  }
  const rows = hidden.map(h => `${h} [data-e3-rows]`).join(',');
  const wait = hidden.map(h => `${h} [data-e3-wait]`).join(',');
  return `${rows}{display:none!important}${wait}{display:block!important}`;
}

/** Merkmal entfernen — ab hier entscheidet React. */
export function releaseStatsPending(): void {
  const d = document.documentElement;
  d.removeAttribute(PENDING_ATTR);
  d.removeAttribute(USER_BUCKET_ATTR);
}
