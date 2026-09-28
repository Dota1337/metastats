#!/usr/bin/env node
/**
 * Baut public/tft-loot-tables-{set}.json und public/tft-wisps-{set}.json fuer
 * /tft/tools/tables.
 *
 * Quelle ist Little Buddy Bot (littlebuddybot.com). Die Loot-Tabellen gibt es
 * dort nur als Bilder — sie sind unten von Hand abgeschrieben (Stand der Bilder
 * je Tabelle in `patch`). Die Wisps kommen aus der oeffentlichen Google-Tabelle,
 * die die Wisps-Seite selbst laedt. Riot liefert fuer keine dieser Tabellen
 * Wahrscheinlichkeiten; einzige Ausnahme sind die Booster Packs, dort stehen
 * die Gewichte in map22 (BoosterPack{1,2,3}Distribution) und sind neuer als
 * das 18.1-Bild — deshalb gelten dort Riots Werte (User-Entscheid 2026-09-27).
 *
 * Aufruf:  node scripts/import-tft-tables.mjs [--set 18] [--csv datei.csv]
 *
 * Jeder apiName muss im Asset-Bundle des Sets stehen (oder in ICON_OVERRIDES);
 * sonst Exit 1, damit kein Eintrag still ohne Bild und Namen live geht.
 * Aendern sich die Tabellen im Patch: Abschrift unten anpassen, neu laufen lassen.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';

const WISPS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT7Tuku8zc7N5ZaEvVy5XAicB1hOOrlNdAZD_R_xIyoi8lhW82-kgUMrnJzjpm1dqH6pJyK2wYobO4r/pub?gid=0&single=true&output=csv';

const arg = name => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const SET = Number(arg('--set') ?? JSON.parse(readFileSync('public/tft-set.json', 'utf8')).setNumber);
if (!Number.isInteger(SET)) throw new Error('Set-Nummer nicht lesbar');
const bundle = JSON.parse(readFileSync(`public/tft-assets-${SET}.json`, 'utf8'));

// Nicht im Bundle, aber als CDragon-Datei vorhanden (files.exported.txt, 2026-09-27),
// oder als eigenes Bild unter public/tft-extra/ (check-drift c2 prueft, dass es existiert).
const ICON_OVERRIDES = {
  TFT_ArmoryKeyComponent: { name: 'Component Anvil', icon: 'assets/characters/tft_armorykeycomponent/hud/icons2d/tft_armorykeycomponent_square.png' },
  // CDragon (latest + PBE, 2026-09-28) liefert nur den Platzhalter missing-t3; Bild von
  // tactics.tools (ap.tft.tools/img/augments/DA_TraitLadder3.png). Entfernen, sobald CDragon ein echtes hat.
  DA_TraitLadder: { name: 'Trait Ladder', icon: `/tft-extra/augments/${SET}/DA_TraitLadder.webp` },
};

const missing = [];
function resolve(api) {
  const o = ICON_OVERRIDES[api];
  if (o) return o;
  const e = bundle.items?.[api] ?? bundle.champions?.[api] ?? bundle.augments?.[api];
  if (!e) { missing.push(api); return { name: api, icon: null }; }
  const icon = e.tile || e.icon;
  const usable = typeof icon === 'string' && icon.startsWith('assets/') && !/missing-t\d/.test(icon);
  return { name: e.name, icon: usable ? icon : null };
}

// ---------- Bausteine der Abschrift ----------
const R = (k, n = 1, more = {}) => ({ k, ...(n !== 1 ? { n } : {}), ...more });
const withApi = (k, api, n = 1, more = {}) => {
  const { name, icon } = resolve(api);
  return R(k, n, { api, name, ...(icon ? { icon } : {}), ...more });
};
const gold = n => R('gold', n);
const xp = n => R('xp', n);
const reroll = n => R('reroll', n);
const orb = (cost, n = 1, stars = null) => R('randomUnit', n, { cost, ...(stars ? { stars } : {}) });
const champ = (api, n = 1, stars = null) => {
  const c = bundle.champions?.[api];
  return withApi('champion', api, n, { cost: c?.cost ?? null, ...(stars ? { stars } : {}) });
};
const item = (api, n = 1) => withApi('item', api, n);
const anvil = (kind, n = 1) => withApi('item', {
  component: 'TFT_ArmoryKeyComponent', full: 'TFT_Item_GrantCompletedAnvil', artifact: 'TFT_Item_GrantOrnnAnvil',
}[kind], n);
const comp = (n = 1) => R('component', n);
const fullItem = (n = 1) => R('fullItem', n);
const radiant = (n = 1) => R('radiant', n);
const emblem = (n = 1) => R('emblem', n);
const remover = (n = 1) => item('DA_Consumable_ItemRemover', n);
const gremover = (n = 1) => item('DA_Consumable_GoldenItemRemover', n);
const reforger = (n = 1) => item('DA_Reforger', n);
const lucky = (n = 1) => item('DA_LuckyItemChest', n);
const rlucky = (n = 1) => item('DA_RadiantLuckyItemChest', n);
const thief = (n = 1) => item('DA_ThiefsGloves', n);
const rthief = (n = 1) => item('DA_ThiefsGlovesRadiant', n);
const crown = (n = 1) => item('DA_TacticiansCrown', n);
const cape = (n = 1) => item('DA_TacticiansCape', n);
const shield = (n = 1) => item('DA_TacticiansShield', n);
const lesserDup = (n = 1) => item('DA_Consumable_LesserChampionDuplicator', n);
const dup = (n = 1) => item('DA_Consumable_ChampionDuplicator', n);

const row = (chance, rewards, cond = null) => ({ chance, ...(cond ? { cond } : {}), rewards });
const sub = (label, rows) => ({ ...(label ? { label } : {}), rows });
const table = (key, api, patch, stage, subs) => {
  const { name, icon } = resolve(api);
  return { key, api, name, ...(icon ? { icon } : {}), patch, stage, subs };
};

// ---------- Loot-Tabellen (Reihenfolge = Anzeige) ----------
const B = (...xs) => xs.map(([cost, n = 1, stars = null]) => orb(cost, n, stars));
const T = (n, rows) => rows.map(([c, r]) => row(c, r, { t: 'traits', n }));

const tables = [
  table('traitladder', 'DA_TraitLadder', '18.2', '2', [sub(null, [
    ...T(2, [[null, [gold(1), reforger()]]]),
    ...T(3, [[null, [gold(3)]]]),
    ...T(4, [[null, [gold(6)]]]),
    ...T(5, [[null, [comp()]]]),
    ...T(6, [[50, [gold(10)]], [50, [orb(3, 3)]]]),
    ...T(7, [[null, [gold(8), anvil('component')]]]),
    ...T(8, [[57, [comp(2), reforger()]], [43, [anvil('full')]]]),
    ...T(9, [[null, [gold(2), orb(5, 3)]]]),
    ...T(10, [[null, [gold(20)]]]),
    ...T(11, [[null, [R('tacticianItem')]]]),
    ...T(12, [[null, [orb(4, 3), lucky()]]]),
    ...T(13, [[null, [gold(8), comp(4), remover()]]]),
    ...T(14, [[null, [gold(10), item('DA_MasterworkUpgrade')]]]),
  ])]),

  // Gewichte aus Riots BoosterPack{1,2,3}Distribution (map22, CDragon latest,
  // 2026-09-27). Inhalte decken sich mit dem LBB-Bild 18.1; einzige Abweichung
  // Pack+ letzte Zeile: Riot 3, Bild 4.
  table('booster', 'DA_BoosterPack', '18.3', '2 / 3 / 4', [
    sub({ t: 'booster', api: 'DA_BoosterPack', name: resolve('DA_BoosterPack').name, stage: 2 }, [
      row(13.5, B([1], [2], [3, 3])), row(13.5, B([1, 2], [2, 2], [3], [1, 1, 2])),
      row(13.5, B([1, 2], [2, 2], [3], [3])), row(13.5, B([1, 3], [3, 2], [1, 1, 2])),
      row(13.5, B([1, 2], [2, 2], [3, 2])), row(13.5, B([1], [2], [3], [1, 2, 2])),
      row(8, B([1], [2], [3], [2, 1, 2])), row(8, B([1], [2], [3], [2, 1, 2])),
      row(1.5, B([1], [2], [3, 1, 2])), row(1.5, B([1, 3], [2], [3], [4])),
    ]),
    sub({ t: 'booster', api: 'DA_BoosterPackPlus', name: resolve('DA_BoosterPackPlus').name, stage: 3 }, [
      row(11, B([2, 2], [4, 2], [2, 1, 2])), row(11, B([2], [3, 2], [4], [2, 1, 2])),
      row(11, B([2], [4], [1, 4, 2])), row(11, B([1], [3, 3], [4, 2])),
      row(11, B([2, 2], [4, 2], [1, 2, 2])), row(11, B([2], [3, 2], [4], [2, 1, 2])),
      row(10, B([2], [3], [4], [1, 1, 3])), row(8, B([2], [3], [4], [3, 1, 2])),
      row(8, B([1], [2, 2], [4], [3, 1, 2])), row(5, B([2, 3], [4, 3])),
      row(3, B([3, 3], [4], [5])),
    ]),
    sub({ t: 'booster', api: 'DA_BoosterPackPlusPlus', name: resolve('DA_BoosterPackPlusPlus').name, stage: 4 }, [
      row(12, B([3], [5], [2, 1, 3])), row(12, B([1], [2], [5], [3, 1, 2], [3, 1, 2])),
      row(12, B([5], [1, 1, 2], [1, 1, 2], [2, 1, 2], [3, 1, 2])), row(12, B([4], [5], [5], [2, 1, 2], [2, 1, 2])),
      row(12, B([4, 4], [5, 2])), row(12, B([4, 3], [5], [1, 1, 2], [2, 1, 2])),
      row(12, B([1], [3, 2], [5, 2], [1, 1, 3])), row(4, B([3, 2], [5, 4])),
      row(4, B([3], [5], [1, 1, 3], [1, 1, 3])), row(4, B([5], [3, 1, 2], [4, 1, 2])),
      row(3, B([3], [5], [2, 1, 2], [4, 1, 2])), row(1, B([1], [3], [3], [4], [5, 1, 2])),
    ]),
  ]),

  table('frontline', 'DA_FrontlineFoundation', '18.3', '2', [sub(null, [
    row(null, [champ('DA_18_Kobuko', 1, 2), item('DA_18_EmblemBrawler')]),
    row(null, [champ('DA_18_Leona', 1, 2), item('DA_18_EmblemDefender')]),
    row(null, [champ('DA_18_Yorick', 1, 2), item('DA_18_EmblemJuggernaut')]),
    row(null, [champ('DA_18_RekSai', 1, 2), item('DA_18_EmblemBrawler')]),
    row(null, [champ('DA_18_Ornn', 1, 2), item('DA_18_EmblemDefender')]),
    row(null, [champ('DA_18_Rakan', 1, 2), item('DA_18_EmblemVanguard')]),
  ])]),

  table('backline', 'DA_BacklineBlueprint', '18.1', '2', [sub(null, [
    row(null, [champ('DA_18_Azir'), item('DA_18_EmblemExecutioner')]),
    row(null, [champ('DA_18_Cassiopeia'), item('DA_18_EmblemSpellweaver')]),
    row(null, [champ('DA_18_Diana'), item('DA_18_EmblemSlayer')]),
    row(null, [champ('DA_CrimsonRaptor18'), item('DA_18_EmblemRapidfire')]),
    row(null, [champ('DA_18_Tristana'), item('DA_18_EmblemHunter')]),
  ])]),

  table('slightly', 'DA_SlightlyMagicRoll', '18.1', '2', [sub(null, [
    row(null, [reroll(6)], { t: 'face', n: 1 }),
    row(null, [gold(10)], { t: 'face', n: 2 }),
    row(null, [gold(3), orb(2, 1, 2)], { t: 'face', n: 3 }),
    row(null, [fullItem(), reforger()], { t: 'face', n: 4 }),
    row(null, [R('hp', 1, { v: 160 })], { t: 'face', n: 5 }),
    row(null, [emblem()], { t: 'face', n: 6 }),
  ])]),

  table('magicroll', 'DA_MagicRoll', '18.2', '3', [sub(null, [
    row(25, [R('hp', 1, { v: 250 })], { t: 'sum', v: '4-8' }),
    row(36, [orb(1, 1, 2), orb(2, 2, 2), orb(3, 1, 2)], { t: 'sum', v: '9-11' }),
    row(32, [R('sameComponent', 4), reforger()], { t: 'sum', v: '12-15' }),
    row(4, [item('DA_Component_FryingPan'), comp(2)], { t: 'sum', v: '16-17' }),
    row(1.4, [R('goldRange', 1, { v: '4-6' }), lesserDup(3)], { t: 'combo', v: '111 / 222 / 333' }),
    row(1.4, [cape()], { t: 'combo', v: '444 / 555 / 666' }),
    row(0.5, [R('specialEgg', 1, { turns: 3, contents: [gold(5), orb(5, 2), crown()] })], { t: 'combo', v: '626' }),
  ])]),

  table('expected', 'DA_ExpectedUnexpectedness', '18.2', '2', [
    sub({ t: 'stage', n: 2 }, [row(36, [orb(4, 2)]), row(32, [anvil('component', 2), reforger(3)]), row(25, [gold(9)]), row(4, [anvil('artifact')]), row(3, [crown()])]),
    sub({ t: 'stage', n: 3 }, [row(36, [gold(5), lesserDup(2)]), row(32, [gold(3), anvil('full')]), row(25, [gold(18)]), row(4, [comp(3)]), row(3, [emblem(2)])]),
    sub({ t: 'stage', n: 4 }, [row(36, [orb(5, 3)]), row(32, [gold(5), lucky()]), row(25, [gold(20)]), row(4, [fullItem(), comp(2)]), row(3, [orb(5, 3), dup()])]),
  ]),

  table('goldenegg', 'DA_GoldenEgg', '18.2', '4', [sub(null, [
    row(15, [gold(88), crown()]),
    row(15, [gold(10), crown(), radiant(2)]),
    row(15, [gold(30), crown(2), thief()]),
    row(15, [gold(25), crown(), rthief(), thief()]),
    row(10, [gold(10), crown(), radiant(), R('artifact'), fullItem(), remover()]),
    row(10, [gold(30), crown(), orb(5, 4), dup(2)]),
    row(10, [gold(25), item('DA_Artifact_InfinityForce'), item('DA_Artifact_ZhonyasParadox'), item('DA_Artifact_TheIndomitable'), dup(), remover(2)]),
    row(10, [gold(10), crown(), item('DA_InfinityEdge'), item('DA_JeweledGauntlet'), item('DA_StrikersFlail'), item('DA_HandOfJustice'), item('DA_Quicksilver'), remover()]),
  ])]),

  table('chaos', 'DA_CallToChaos', '18.1', '4', [sub(null, [
    row(11, [gold(58)]), row(11, [xp(64)]), row(11, [reroll(40)]),
    row(11, [anvil('full'), item('DA_GoldenEgg')]),
    row(11, [gold(8), rlucky(), remover()]),
    row(11, [anvil('component', 2), item('DA_Component_FryingPan'), item('DA_Component_Spatula')]),
    row(11, [thief(3), remover()]),
    row(11, [lucky(3), remover()]),
    row(11, [R('uniqueComponents', 6)]),
  ])]),
];

// ---------- Coven (Bild 18.3) ----------
// Federzahl = Faehigkeitsstaerke mit Dark Ritual (DA_18_CovenTraitAugment_LootToAP).
// Essenz je Stufe: Bild 22/28/35/60 pro Niederlage, Riot-Datei 18/25/32/60 —
// Anzeige nach Bild (User-Entscheid 2). Stufen-Grenzen aus dem Bundle: 3, 4, 5-6, 7+.
const cam = (n = 1) => champ('DA_18_Camille', n);
const cait = (n = 1) => champ('DA_18_Caitlyn', n);
const eli = (n = 1) => champ('DA_18_Elise', n);
const cass = (n = 1) => champ('DA_18_Cassiopeia', n);
const morg = (n = 1) => champ('DA_18_Morgana', n);
const lux = (n = 1, s = null) => champ('DA_18_Lux_Coven', n, s);
const kennen = n => champ('DA_18_Kennen', n);
const draven = n => champ('DA_Draven18', n);
const sentinel = n => champ('DA_Sentinel18', n);
const E = (essence, ap, rows) => sub({ t: 'essence', essence, ap }, rows);

const coven = {
  key: 'coven',
  ...(() => { const { name, icon } = resolve('DA_18_CovenTraitAugment_LootToAP'); return { api: 'DA_18_CovenTraitAugment_LootToAP', augmentName: name }; })(),
  name: bundle.traits?.DA_18_Coven?.name ?? 'Coven',
  icon: bundle.traits?.DA_18_Coven?.icon ?? null,
  patch: '18.3',
  essence: [
    { units: '3', kill: 2, loss: 22 },
    { units: '4', kill: 2, loss: 28 },
    { units: '5-6', kill: 3, loss: 35 },
    { units: '7+', kill: 10, loss: 60 },
  ],
  subs: [
    E(40, 7, [row(33, [gold(4)]), row(33, [orb(2), orb(2)]), row(33, [cass(), cam()])]),
    E(85, 15, [row(33, [gold(2), comp()]), row(33, [gold(10)]), row(33, [eli(), comp()])]),
    E(130, 50, [row(25, [comp(2)]), row(25, [gold(3), fullItem()]), row(25, [cass(), eli(3), comp()]), row(25, [gold(3), cait(3), comp()])]),
    E(185, 75, [row(25, [anvil('full'), comp()]), row(25, [gold(10), anvil('full')]), row(25, [gold(10), comp(2), reforger()]), row(25, [cait(3), cam(3), anvil('full')])]),
    E(250, 125, [
      row(20, [gold(20), anvil('full', 2)]), row(20, [gold(5), morg(3), lucky(), fullItem()]),
      row(20, [gold(18), lucky(2), reforger()]), row(20, [gold(18), lux(), lucky(), anvil('component', 2)]),
      row(20, [gold(18), anvil('artifact'), anvil('full')])]),
    E(365, 200, [
      row(17, [gold(27), radiant(2), remover(2), reforger(2)]),
      row(17, [gold(22), morg(3), sentinel(3), rlucky(), thief()]),
      row(17, [gold(22), rlucky(), anvil('full', 2), emblem()]),
      row(17, [gold(15), kennen(3), rthief(2), remover(3)]),
      // Symbol im Bild (weisser Bogen ueber Tropfen) gegen alle Set-18-Icons
      // abgeglichen, kein Treffer — bleibt "?" (User-Entscheid 4).
      row(17, [gold(22), morg(), rlucky(), R('unknown', 2)]),
      row(17, [gold(12), draven(3), crown(), rlucky(), gremover()])]),
    E(500, 300, [
      row(20, [radiant(3), anvil('full', 2), remover(3), reforger(3)]),
      row(20, [orb(5, 3), orb(5, 3), rlucky(2), fullItem(2), remover(3)]),
      row(20, [gold(20), rlucky(2), anvil('artifact', 2), remover(3)]),
      row(20, [gold(10), rlucky(2), emblem(4), gremover()]),
      row(20, [gold(15), kennen(3), lux(1, 2), shield(), rlucky(2)])]),
    E(650, 400, [
      row(33, [gold(30), orb(5, 3), orb(5, 3), orb(5, 3), shield(), radiant(3), gremover()]),
      row(33, [gold(10), lux(1, 2), morg(3), cape(), rlucky(3), gremover()]),
      row(33, [gold(40), crown(), radiant(3), dup(3), gremover(), reforger(2)])]),
    E(800, 1666, [
      row(50, [gold(100), cape(3), radiant(6), gremover()]),
      row(50, [gold(100), shield(), radiant(6), dup(6)])]),
  ],
};

// ---------- Wisps ----------
function parseCsv(t) {
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows;
}

const csvPath = arg('--csv');
let csv;
if (csvPath) csv = readFileSync(csvPath, 'utf8');
else {
  const res = await fetch(WISPS_CSV_URL);
  if (!res.ok) throw new Error(`Wisps-Tabelle: HTTP ${res.status}`);
  csv = await res.text();
}
const [head, ...body] = parseCsv(csv);
const need = ['Name', 'mName', 'Icon URL', 'Description', 'Tier', 'Cost', 'Doubles', 'Tockers', 'Special Conditions', 'Re-offer Cooldown', 'Round Bands'];
for (const h of need) if (!head.includes(h)) throw new Error(`Wisps-Tabelle: Spalte "${h}" fehlt — Aufbau geaendert?`);
const W = body.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i].trim()])));
if (W.length < 100) throw new Error(`Wisps-Tabelle: nur ${W.length} Zeilen`);

// Varianten tragen vier Upgrade-Schreibweisen plus _Prismatic (gezaehlt 2026-09-27:
// 149 _Upgrade, 24 andere Upgrade-Muster, 19 _Prismatic).
// Die drei Traenke heissen DA_*Potion18_Upgrade_Charm zu DA_*Potion18_Charm — deshalb
// mehrere Kandidaten, der erste vorhandene gewinnt.
function baseCandidates(m) {
  return [
    m.replace(/_Upgrade_Charm$/, '_Charm'),
    m.replace(/_Upgrade_Charm$/, '').replace(/_Upgrade$/, '').replace(/_Prismatic$/, '')
      .replace(/Upgrade18$/, '18').replace(/^(DA_18_\w+?)Upgrade$/, '$1'),
  ].filter(b => b !== m);
}

// Bild je Wisp: die LBB-Tabelle nennt pro Zeile ein Art-Bild (Art × Stufe, 19 Dateien
// in Set 18). User-Entscheid 2026-09-27: einmalig kopieren und selbst ausliefern.
const WISP_ICON_RE = /^https:\/\/images\.littlebuddybot\.workers\.dev\/tft\/set\d+\/wisps\/T_ShopCardsIcon\d+_(Champion|Combat|GoldXP|Item|Misc|Risky|Shop)_Tier([123])\.webp$/;
const WISP_ICON_DIR = `public/tft-extra/wisps/${SET}`;
const wispIcons = new Map(); // lokale Datei → Quell-URL
function wispIcon(d) {
  const m = WISP_ICON_RE.exec(d['Icon URL']);
  if (!m) throw new Error(`Wisp ${d.mName}: Bild-URL "${d['Icon URL']}" passt nicht aufs Muster`);
  if (Number(m[2]) !== Number.parseInt(d.Tier, 10)) throw new Error(`Wisp ${d.mName}: Bild-Stufe ${m[2]} ≠ Stufe ${d.Tier}`);
  const file = `${m[1]}_Tier${m[2]}.webp`;
  wispIcons.set(file, d['Icon URL']);
  return { cat: m[1], icon: `/tft-extra/wisps/${SET}/${file}` };
}
const ROUND_ORDER = ['Early', 'EarlyMid', 'Mid', 'MidLate', 'Late', 'VeryLate'];
function rounds(v) {
  if (/^All bands/i.test(v)) return [...ROUND_ORDER];
  const parts = v.split(';').map(s => s.trim()).filter(s => ROUND_ORDER.includes(s));
  return ROUND_ORDER.filter(r => parts.includes(r));
}
function toWisp(d) {
  const tier = Number.parseInt(d.Tier, 10); // "1.Rabbit" / "2.Rabbit" → Stufe 1 / 2
  if (![1, 2, 3].includes(tier)) throw new Error(`Wisp ${d.mName}: Stufe "${d.Tier}" unbekannt`);
  const req = d['Special Conditions'].replace(/^Requires:\s*/i, '').trim();
  const excl = [];
  for (let i = 1; i <= 25; i++) { const n = d[`MutuallyExclusiveItem${i}Name`]; if (n) excl.push(n); }
  return {
    api: d.mName,
    name: d.Name,
    desc: d.Description,
    tier,
    ...wispIcon(d),
    cost: Number(d.Cost) || 0,
    rounds: rounds(d['Round Bands']),
    doubles: d.Doubles === 'Yes',
    tockers: d.Tockers === 'Yes',
    ...(req ? { req } : {}),
    ...(Number(d['Re-offer Cooldown']) ? { cooldown: Number(d['Re-offer Cooldown']) } : {}),
    ...(excl.length ? { excl: [...new Set(excl)] } : {}),
  };
}
const byApi = new Map(W.map(d => [d.mName, d]));
const bases = new Map();
const variants = [];
for (const d of W) {
  const b = baseCandidates(d.mName).find(c => byApi.has(c));
  if (b) variants.push([b, d]);
  else bases.set(d.mName, { ...toWisp(d), variants: [] });
}
for (const [b, d] of variants) {
  bases.get(b).variants.push({ ...toWisp(d), kind: /_Prismatic$/.test(d.mName) ? 'prismatic' : 'upgrade' });
}
const wisps = [...bases.values()].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

if (missing.length) {
  console.error(`✗ ${missing.length} apiName(s) nicht im Bundle tft-assets-${SET}.json: ${[...new Set(missing)].join(', ')}`);
  process.exit(1);
}

// Allgemeine Belohnungen ohne eigenes Item bekommen feste CDragon-Symbole, wie
// die LBB-Bilder sie zeigen. Fertiges Item (gruen) und Emblem (grau) nutzen den
// blauen Komponenten-„?" und werden in der Oberflaeche eingefaerbt — ein
// gruenes/graues „?" gibt es auf CDragon nicht. Jeder Pfad wird unten geprueft.
const PAIRS = 'assets/maps/particles/tft/item_icons/pairs/';
const HEXCORE = 'assets/maps/tft/icons/items/hexcore/';
const GENERIC_ICONS = {
  gold: PAIRS + 'assistgivegold.png',
  goldRange: PAIRS + 'assistgivegold.png',
  component: PAIRS + 'assistrandomcomponent.png',
  sameComponent: PAIRS + 'assistrandomcomponent.png',
  uniqueComponents: PAIRS + 'assistrandomcomponent.png',
  fullItem: PAIRS + 'assistrandomcomponent.png',
  emblem: PAIRS + 'assistrandomcomponent.png',
  radiant: PAIRS + 'doubleup_assistarmory_randomitem_radiant.png',
  artifact: PAIRS + 'doubleup_assistarmory_randomitem_ornn.png',
  xp: HEXCORE + 'tft17_carouselmarket_xp.png',
  reroll: HEXCORE + 'tft17_carouselmarket_rerolls.png',
};
const unitIcon = cost => `${PAIRS}doubleup_assistarmory_champ_${cost}c.png`;
function addGenericIcons(rewards) {
  for (const r of rewards) {
    if (r.contents) addGenericIcons(r.contents);
    if (r.icon) continue;
    const icon = r.k === 'randomUnit' ? unitIcon(r.cost) : GENERIC_ICONS[r.k];
    if (icon) r.icon = icon;
  }
}
for (const t of [...tables, coven]) for (const s of t.subs) for (const row of s.rows) addGenericIcons(row.rewards);

const genericPaths = [...new Set([...Object.values(GENERIC_ICONS), ...[1, 2, 3, 4, 5].map(unitIcon)])];
const dead = [];
for (const p of genericPaths) {
  const res = await fetch('https://raw.communitydragon.org/latest/game/' + p, { method: 'HEAD' });
  if (!res.ok) dead.push(`${p} (${res.status})`);
}
if (dead.length) {
  console.error(`✗ ${dead.length} Symbol(e) fehlen auf CDragon: ${dead.join(', ')}`);
  process.exit(1);
}

// Fehlende Wisp-Bilder einmalig holen. Vorhandene bleiben unangetastet; schlaegt
// eines fehl, bricht das Skript ab, bevor eine JSON auf ein fehlendes Bild zeigt.
mkdirSync(WISP_ICON_DIR, { recursive: true });
const badIcons = [];
for (const [file, url] of wispIcons) {
  const dest = `${WISP_ICON_DIR}/${file}`;
  if (existsSync(dest)) continue;
  const res = await fetch(url);
  const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  if (!buf || res.headers.get('content-type') !== 'image/webp' || buf.length === 0) {
    badIcons.push(`${file} (${res.status} ${res.headers.get('content-type')})`);
    continue;
  }
  writeFileSync(dest + '.tmp', buf);
  renameSync(dest + '.tmp', dest);
}
if (badIcons.length) {
  console.error(`✗ ${badIcons.length} Wisp-Bild(er) nicht ladbar: ${badIcons.join(', ')}`);
  process.exit(1);
}

const now = new Date().toISOString();
const source = { name: 'Little Buddy Bot', url: 'https://www.littlebuddybot.com' };
writeFileSync(`public/tft-loot-tables-${SET}.json`, JSON.stringify({ set: SET, source, fetchedAt: now, tables, coven }, null, 1) + '\n');
writeFileSync(`public/tft-wisps-${SET}.json`, JSON.stringify({ set: SET, source: { ...source, url: 'https://www.littlebuddybot.com/tft-wisps' }, fetchedAt: now, wisps }, null, 1) + '\n');

const sums = tables.flatMap(t => t.subs.map(s => `${t.key}${s.label ? '/' + (s.label.name ?? s.label.n) : ''}=${Math.round(s.rows.reduce((a, r) => a + (r.chance ?? 0), 0) * 10) / 10}`));
console.log(`✓ Set ${SET}: ${tables.length} Loot-Tabellen + Coven (${coven.subs.length} Schwellen), ${wisps.length} Wisps mit ${variants.length} Varianten (${W.length} Zeilen)`);
console.log('  Summen:', sums.join(' '));
