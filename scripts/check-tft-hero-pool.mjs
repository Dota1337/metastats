#!/usr/bin/env node
// Waechter fuer den Bildpool der TFT-Kopfzone.
//
// Warum es ihn gibt: bis Commit A zeigte die Kopfzone Chibis und Little
// Legends -- die sind set-unabhaengig und koennen nicht leerlaufen. Seit sie
// Set-Splashes zeigt, haengt sie am laufenden Set. Bricht die Ableitung, faellt
// eine Einheit still aus dem Pool (app/lib/ddragon-splash.ts), und ein
// ddragon-403 wird erst im Browser per onError auf opacity 0 gesetzt. Beides
// merkt sonst zuerst der Nutzer.
//
// Das ist ein bewusster Spiegel der Filterlogik aus app/lib/ddragon-splash.ts
// (siehe reference_dual_module_patterns): driftet der Spiegel, faellt dieser
// Check laut aus, statt dass die Kopfzone leise leer bleibt.
//
// Seit 2026-08-22 ohne Kostenfilter — der Pool sind alle spielbaren Einheiten
// des Sets (56 statt 8). Damit werden hier 56 HEAD-Requests parallel gefahren
// statt 8; gemessen 0,7 s gegen ddragon, kein Rate-Limit. Der Check wird damit
// aber deutlich empfindlicher: nach einem Set-Bump muessen 56 URLs aufloesen,
// nicht 8. Faellt er aus, gehoert die tote Skin-Nummer in KNOWN_MISSING —
// hier UND in app/lib/ddragon-splash.ts.
import { readFileSync } from 'node:fs';

// Set 18 bricht die Namenskonvention: die apiNames heissen `DA_18_LeBlanc`,
// `DA_Amumu18` oder `DA_KogMaw18_AD` statt `TFT17_Kaisa`. Das alte Muster
// traf davon keinen einzigen — gemessen am 2026-08-26 gegen ddragon: 0 von
// 91 Set-18-Einheiten aufloesbar, die Kopfzone waere leer geblieben.
//
// Drei Regeln, alle gegen Set 17 UND Set 18 nachgemessen:
//   1. Praefix `TFT<n>[b]_` ODER `DA_`, jeweils optional gefolgt von `<n>_`.
//   2. Nur das erste Segment zaehlt — ddragon-IDs enthalten nie einen
//      Unterstrich, `_AD`/`_AP`/`_Base`/`_Fae` sind Set-Varianten derselben
//      Einheit (`DA_18_MasterYi_AD` -> MasterYi).
//   3. Angehaengte Set-Nummer abschneiden (`Amumu18` -> Amumu); kein
//      ddragon-Champion endet auf einer Ziffer.
// Ergebnis: Set 17 unveraendert 56 Set-Skins, Set 18 41 statt 0.
const API_PREFIX_RE = /^(?:tft\d+b?|da)_(?:\d+_)?/i;

// ddragon schreibt ein paar IDs anders als das TFT-Bundle. Nur gemessene
// Faelle stehen hier: `DA_18_LeBlanc` -> Leblanc_5 loest auf, LeBlanc_5 nicht.
const DDRAGON_ID_ALIAS = { LeBlanc: 'Leblanc', KhaZix: 'Khazix', KaiSa: 'Kaisa', VelKoz: 'Velkoz', ChoGath: 'Chogath', BelVeth: 'Belveth' };

// Aus dem apiName die ddragon-Champion-ID ableiten. Leerstring, wenn nichts
// uebrig bleibt — der Aufrufer macht daraus `null`.
function ddragonChampionId(apiName) {
  const base = apiName.replace(API_PREFIX_RE, '').split('_')[0].replace(/\d+$/, '');
  return DDRAGON_ID_ALIAS[base] || base;
}
const SKIN_NUM_RE = /_(\d+)\.png$/;
const NON_PLAYABLE_RE = /_(enemy|pve|minion|npc)_|^tft\d+b?_(enemy|pve)/i;
const KNOWN_MISSING = new Set(['Blitzcrank_65', 'IvernMinion_27', 'Fiddlesticks_46', 'Kobuko_2', 'Alune_15']);
const MIN_POOL = 2;

const bundle = JSON.parse(readFileSync(new URL('../public/tft-assets.json', import.meta.url), 'utf8'));

const pool = [];
for (const [apiName, champ] of Object.entries(bundle.champions || {})) {
  if (!Array.isArray(champ.traits) || champ.traits.length === 0) continue;
  if (NON_PLAYABLE_RE.test(apiName)) continue;
  const championId = ddragonChampionId(apiName);
  if (!championId) continue;
  const file = String(champ.icon || '').split('/').pop() ?? '';
  const skinNum = file.match(SKIN_NUM_RE)?.[1] ?? '0';
  if (skinNum === '0') continue;
  if (KNOWN_MISSING.has(`${championId}_${skinNum}`)) continue;
  pool.push({
    name: champ.name,
    url: `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championId}_${skinNum}.jpg`,
  });
}

console.log(`[tft-hero-pool] ${pool.length} Einheiten im Kopfzonen-Pool (Set ${bundle.set ?? '?'})`);

if (pool.length < MIN_POOL) {
  console.error(
    `[tft-hero-pool] FEHLER: nur ${pool.length} Einheit(en), mindestens ${MIN_POOL} noetig.\n`
    + '  Die TFT-Kopfzone rendert dann gar kein Bild. Haeufigste Ursache nach einem\n'
    + '  Set-Bump: die Skin-Nummern der neuen Einheiten loesen bei ddragon nicht auf.',
  );
  process.exit(1);
}

// Erreichbarkeit nur pruefen, wenn ein Netzweg erwuenscht ist: ddragon
// antwortet auf eine nicht existierende Skin-Nummer mit 403, nicht 404.
if (process.env.SKIP_NET === '1') {
  console.log('[tft-hero-pool] Netzpruefung uebersprungen (SKIP_NET=1)');
  process.exit(0);
}

const results = await Promise.all(
  pool.map(async u => {
    try {
      const res = await fetch(u.url, { method: 'HEAD' });
      return { ...u, status: res.status };
    } catch (err) {
      return { ...u, status: 0, err: String(err) };
    }
  }),
);

const broken = results.filter(r => r.status !== 200);
for (const b of broken) console.error(`[tft-hero-pool] ${b.status} ${b.name} ${b.url}`);

const usable = results.length - broken.length;
if (usable < MIN_POOL) {
  console.error(
    `[tft-hero-pool] FEHLER: nur ${usable} erreichbare Bilder, mindestens ${MIN_POOL} noetig.\n`
    + '  Nicht erreichbare Skins gehoeren in KNOWN_MISSING in app/lib/ddragon-splash.ts\n'
    + '  UND hier -- sonst rendert die Kopfzone ein Loch.',
  );
  process.exit(1);
}
if (broken.length > 0) {
  console.error(
    `[tft-hero-pool] FEHLER: ${broken.length} Bild(er) nicht erreichbar (Pool waere mit ${usable} noch gross genug,\n`
    + '  aber jede tote URL ist auf mindestens einer Route ein sichtbares Loch).',
  );
  process.exit(1);
}

console.log(`[tft-hero-pool] OK — alle ${usable} Bilder erreichbar`);
