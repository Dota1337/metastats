import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyLocalizedNames, NAME_LANGS } from './tft-localized-names.mjs';
import { LANGS } from '../../app/lib/lang-path.ts';
import { tftAssetsForLang, tftLabel, tftLocalTrait, tftTraitDescText, tftTraitDisplayName, tftTraitLabelByName } from '../../app/lib/tft-cdragon.ts';
import { renderTraitDesc } from '../../app/lib/tft-trait-desc.ts';
import { lootTableNames } from '../../app/lib/tft-loot-names.ts';
import { englishNamesIn } from './contracts.mjs';

function setup(over = {}) {
  const items = {
    Comp: { name: 'BF Sword', composition: [] },
    Active: { name: 'Infinity Edge', composition: ['Comp'] },
    Alias: { name: 'Hull', composition: [] },
    Src: { name: 'Hull', composition: [] },
    Same: { name: 'Bloodthirster', composition: [] },
    Empty: { name: 'Bag', composition: [] },
    Raw: { name: 'Thing', composition: [] },
    Old: { name: 'Old Item', composition: [] },
  };
  const champions = {
    Unit: { name: 'Draven', traits: [] },
    Copy: { aliasOf: 'Unit', name: 'Draven', traits: [] },
    Plant: { name: 'Lifebloom', traits: [] },
  };
  const traits = { Tr: { name: 'Elderwood', desc: 'Grow plants' } };
  const localeItems = {
    de: new Map([['Active', { name: 'Klinge' }], ['Comp', { name: 'Schwert' }], ['Src', { name: 'Rumpf' }], ['Same', { name: 'Bloodthirster' }], ['Empty', { name: '' }], ['Raw', { name: 'tft_item_name_x' }], ['Old', { name: 'Altes Item' }]]),
  };
  const localeSets = {
    de: [{ mutator: 'Other', champions: [{ apiName: 'Unit', name: 'FALSCH' }] }, {
      mutator: 'TFTSet18',
      champions: [{ apiName: 'Unit', name: 'Draven-DE' }],
      traits: [{ apiName: 'Tr', name: 'Ahnenholz', desc: '<b>Pflanzen</b>' }],
    }],
  };
  const stats = applyLocalizedNames({
    items, activeItems: ['Active', 'Alias', 'Same', 'Empty', 'Raw'], champions, traits,
    itemAliases: { Alias: 'Src' }, localeItems, localeSets, mutator: 'TFTSet18', previous: null,
    stripHtml: s => s.replace(/<[^>]+>/g, ''), ...over,
  });
  return { items, champions, traits, stats };
}

test('Sprachen im Fetcher = Sprachen der Seite ohne Englisch', () => {
  assert.deepEqual([...NAME_LANGS].sort(), LANGS.filter(l => l !== 'en').sort());
});

test('Nur aktive Items plus Bauteile, Kopien ueber ihre Quelle', () => {
  const { items, champions, traits } = setup();
  assert.equal(items.Active.names.de, 'Klinge');
  assert.equal(items.Comp.names.de, 'Schwert');
  assert.equal(items.Alias.names.de, 'Rumpf');
  assert.equal(items.Old.names, undefined);
  assert.equal(champions.Copy.names.de, 'Draven-DE');
  assert.equal(champions.Plant.names, undefined);
  assert.equal(traits.Tr.names.de, 'Ahnenholz');
  assert.equal(traits.Tr.descs.de, 'Pflanzen');
});

test('Gleich wie Englisch, leer und Rohschluessel werden nicht gespeichert', () => {
  const { items } = setup();
  assert.equal(items.Same.names, undefined);
  assert.equal(items.Empty.names, undefined);
  assert.equal(items.Raw.names, undefined);
});

test('name bleibt Englisch', () => {
  const { items, champions, traits } = setup();
  assert.equal(items.Active.name, 'Infinity Edge');
  assert.equal(champions.Unit.name, 'Draven');
  assert.equal(traits.Tr.name, 'Elderwood');
  assert.equal(traits.Tr.desc, 'Grow plants');
});

test('Sprachdatei fehlt: Namen des vorherigen Bundles bleiben, ohne Vorgaenger Englisch', () => {
  const previous = {
    items: { Active: { names: { ko: '대검' } } },
    champions: { Unit: { names: { ko: '드레이븐' } } },
    traits: { Tr: { names: { ko: '나무' }, descs: { ko: '식물' } } },
  };
  const a = setup({ localeItems: { de: new Map(), ko: new Map() }, localeSets: { de: [], ko: [] }, previous });
  assert.equal(a.items.Active.names.ko, '대검');
  assert.equal(a.champions.Unit.names.ko, '드레이븐');
  assert.equal(a.traits.Tr.descs.ko, '식물');
  assert.equal(a.stats.ko.fromPrevious, true);
  const b = setup({ localeItems: { de: new Map() }, localeSets: { de: [] }, previous: null });
  assert.equal(b.items.Active.names, undefined);
  assert.equal(tftLabel(b.items.Active, 'de'), 'Infinity Edge');
});

test('Rohquellen-Namen bleiben stehen', () => {
  const champions = { Unit: { name: 'Draven', names: { de: 'Roh' }, traits: [] } };
  setup({ champions });
  assert.equal(champions.Unit.names.de, 'Roh');
});

test('tftLabel: Sprache, Rueckfall, Englisch, kein Eintrag', () => {
  const e = { name: 'Infinity Edge', names: { de: 'Klinge', ko: '' } };
  assert.equal(tftLabel(e, 'de'), 'Klinge');
  assert.equal(tftLabel(e, 'en'), 'Infinity Edge');
  assert.equal(tftLabel(e, 'ko'), 'Infinity Edge');
  assert.equal(tftLabel(e, 'zh'), 'Infinity Edge');
  assert.equal(tftLabel({ name: 'X' }, 'fr'), 'X');
  assert.equal(tftLabel(null, 'de'), undefined);
  assert.equal(tftLabel(undefined, 'de'), undefined);
});

test('Schalter stellt alles auf Englisch', () => {
  const e = { name: 'Elderwood', names: { de: 'Ahnenholz' }, desc: 'en', descs: { de: 'de' } };
  process.env.NEXT_PUBLIC_TFT_LOCAL_NAMES = '0';
  try {
    assert.equal(tftLabel(e, 'de'), 'Elderwood');
    assert.equal(tftTraitDescText(e, 'de'), 'en');
  } finally {
    delete process.env.NEXT_PUBLIC_TFT_LOCAL_NAMES;
  }
  assert.equal(tftLabel(e, 'de'), 'Ahnenholz');
});

test('Synergien: Anzeigename, Text, Name als Schluessel', () => {
  const traits = { DA_18_Elderwood: { name: 'Elderwood', names: { ko: '나무정령' }, icon: null, desc: 'Grow', descs: { ko: '성장' } } };
  const bundle = { traits, items: {}, champions: {} };
  assert.equal(tftTraitDisplayName(bundle, 'DA_18_Elderwood'), 'Elderwood');
  assert.equal(tftTraitDisplayName(bundle, 'DA_18_Elderwood', 'ko'), '나무정령');
  assert.equal(tftTraitLabelByName(bundle, 'Elderwood', 'ko'), '나무정령');
  assert.equal(tftTraitLabelByName(bundle, 'Unbekannt', 'ko'), 'Unbekannt');
  const local = tftLocalTrait(traits.DA_18_Elderwood, 'ko');
  assert.equal(local.name, '나무정령');
  assert.equal(local.desc, '성장');
  assert.equal(traits.DA_18_Elderwood.name, 'Elderwood');
});

test('Startdaten enthalten nur die Sprache des Besuchers', () => {
  const b = {
    items: { A: { name: 'E', names: { de: 'D', ko: 'K' } }, B: { name: 'B' } },
    champions: { U: { name: 'U', names: { ko: 'K' } } },
    traits: { T: { name: 'T', names: { de: 'D' }, desc: 'x', descs: { de: 'dd', ko: 'kk' } } },
  };
  const ko = tftAssetsForLang(b, 'ko');
  assert.deepEqual(ko.items.A, { name: 'E', names: { ko: 'K' } });
  assert.deepEqual(ko.traits.T, { name: 'T', desc: 'x', descs: { ko: 'kk' } });
  assert.equal(ko.items.B, b.items.B);
  const en = tftAssetsForLang(b, 'en');
  assert.deepEqual(en.items.A, { name: 'E' });
  assert.deepEqual(en.traits.T, { name: 'T', desc: 'x' });
  // Das Original bleibt: es liegt im Zwischenspeicher fuer alle Sprachen.
  assert.equal(b.items.A.names.de, 'D');
});

test('Synergie-Texte: Werte-Woerter in der Sprache, Englisch unveraendert, Schalter', () => {
  const trait = { name: 'X', desc: '(@MinUnits@) +@Hp@ %i:scaleHealth%, %i:scaleAD%', tiers: [{ minUnits: 2, variables: { Hp: 100 } }] };
  assert.equal(renderTraitDesc(trait).tiers[0].text, '+100 Health, AD');
  assert.equal(renderTraitDesc(trait, 'en').tiers[0].text, '+100 Health, AD');
  assert.equal(renderTraitDesc(trait, 'de').tiers[0].text, '+100 Leben, Angriffsschaden');
  assert.equal(renderTraitDesc(trait, 'ko').tiers[0].text, '+100 체력, 공격력');
  process.env.NEXT_PUBLIC_TFT_LOCAL_NAMES = '0';
  try {
    assert.equal(renderTraitDesc(trait, 'de').tiers[0].text, '+100 Health, AD');
  } finally {
    delete process.env.NEXT_PUBLIC_TFT_LOCAL_NAMES;
  }
});

test('Synergie-Werte kommen ueber den Namen, nie ueber die Reihenfolge', () => {
  // Sortiert im Bundle: erst {7c65d9f5} (PlantNumThreshold), dann {8e1b920c} (IncreasedDurability).
  const zyra = {
    name: 'Thornmaiden',
    desc: 'Gain @BaseDurability*100@%, increased to @IncreasedDurability*100@% if @PlantNumThreshold@ plants.',
    tiers: [{ minUnits: 1, variables: { BaseDurability: 0.05, '{7c65d9f5}': 6, '{8e1b920c}': 0.1 } }],
  };
  assert.equal(renderTraitDesc(zyra).generalDesc, 'Gain 5%, increased to 10% if 6 plants.');
  // Unbekannter Hash: lieber kein Wert als ein falscher.
  const unknown = { name: 'X', desc: 'Gain @Other@ Health', tiers: [{ minUnits: 1, variables: { '{0f90e7a4}': 0.25 } }] };
  assert.equal(renderTraitDesc(unknown).generalDesc, 'Gain Health');
  // Gross/Klein weicht zwischen Text und Daten ab.
  const rapid = { name: 'R', desc: '(@MinUnits@) +@ASPerAttack*100@%', tiers: [{ minUnits: 2, variables: { ASperAttack: 0.029999971 } }] };
  assert.equal(renderTraitDesc(rapid).tiers[0].text, '+3%');
});

test('Synergie-Werte: Kommawerte, zwei Symbole, keine Stufen', () => {
  const small = { name: 'R', desc: '(@MinUnits@) @A*100@% and @B*100@%', tiers: [{ minUnits: 1, variables: { A: 0.002, B: 0.1000000015 } }] };
  assert.equal(renderTraitDesc(small).tiers[0].text, '0.2% and 10%');
  const two = { name: 'B', desc: '(@MinUnits@) @V@%i:scaleArmor%%i:scaleMR%', tiers: [{ minUnits: 2, variables: { V: 12 } }] };
  assert.equal(renderTraitDesc(two).tiers[0].text, '12 Armor / MR');
  assert.equal(renderTraitDesc(two, 'de').tiers[0].text, '12 Rüstung / Magieresistenz');
  const eclipse = { name: 'Eclipse', desc: 'After @DelaySeconds@ seconds', tiers: [], variables: { DelaySeconds: 8 } };
  assert.equal(renderTraitDesc(eclipse).generalDesc, 'After 8 seconds');
});

test('Echtes Bundle: jeder Wert im Synergie-Text wird gefunden, Stichproben stimmen', () => {
  const a = JSON.parse(readFileSync(new URL('../../public/tft-assets.json', import.meta.url), 'utf8'));
  const byName = n => Object.values(a.traits).find(t => t.name === n);
  const all = t => { const r = renderTraitDesc(t); return [r.generalDesc ?? '', ...r.tiers.map(x => x.text)].join(' | '); };
  for (const t of Object.values(a.traits)) {
    assert.ok(!all(t).includes('@'), `${t.name}: ${all(t)}`);
    // Ein verlorener Wert laesst „gain  Health" oder „every  seconds" zurueck, nach dem
    // Zusammenziehen also ein Prozentzeichen ohne Zahl.
    assert.ok(!/(^|\s)%/.test(all(t)), `${t.name}: ${all(t)}`);
  }
  assert.match(all(byName('Thornmaiden')), /5% Durability, increased to 10% if 6 or more/);
  assert.match(all(byName('Elderwood')), /gain 200 Health/);
  assert.match(all(byName('Juggernaut')), /4% Durability or 20% Durability/);
  assert.match(all(byName('Invoker')), /Mana Regen/);
  assert.match(all(byName('Eclipse')), /After \d+ seconds of combat.*every [\d.]+ seconds/);
});

test('Echte Synergie-Texte: keine englischen Werte-Woerter in den Sprachen', () => {
  const a = JSON.parse(readFileSync(new URL('../../public/tft-assets.json', import.meta.url), 'utf8'));
  for (const lang of NAME_LANGS) {
    for (const [id, t] of Object.entries(a.traits)) {
      if (!t.descs?.[lang]) continue;
      const r = renderTraitDesc({ ...t, desc: t.descs[lang] }, lang);
      const text = [r.generalDesc ?? '', ...r.tiers.map(x => x.text)].join(' ');
      assert.ok(!/\b(Health|Armor|AD|AS|AP|MR)\b/.test(text), `${id} ${lang}: ${text}`);
    }
  }
});

test('Tabellen-Namen: Kennungen aus allen Tiefen, Kopien, Coven, ohne Bundle leer', () => {
  const bundle = {
    items: { I: { name: 'Item', names: { de: 'Ding' } }, Plain: { name: 'Plain' } },
    champions: { U: { name: 'Unit', names: { ko: '유닛' } } },
    traits: { T: { name: 'Coven', names: { de: 'Zirkel' } } },
  };
  const loot = { tables: [{ api: 'I', rows: [{ rewards: [{ api: 'U' }, { api: 'Plain' }, { api: 'Fehlt' }, { n: 2 }] }] }] };
  assert.deepEqual(lootTableNames(loot, bundle, 'Coven'), {
    byApi: { I: { de: 'Ding' }, U: { ko: '유닛' } },
    coven: { de: 'Zirkel' },
  });
  assert.deepEqual(lootTableNames(loot, null, 'Coven'), { byApi: {} });
  assert.deepEqual(lootTableNames(null, bundle), { byApi: {} });
});

test('Tabellen-Namen: echte Datei findet uebersetzte Eintraege', () => {
  const a = JSON.parse(readFileSync(new URL('../../public/tft-assets.json', import.meta.url), 'utf8'));
  const loot = JSON.parse(readFileSync(new URL('../../public/tft-loot-tables-18.json', import.meta.url), 'utf8'));
  const { byApi, coven } = lootTableNames(loot, a, loot.coven.name);
  assert.ok(Object.keys(byApi).length >= 20, `nur ${Object.keys(byApi).length}`);
  assert.ok(coven?.ko, 'Coven ohne Koreanisch');
  for (const table of loot.tables) assert.ok(byApi[table.api]?.ko, `Ueberschrift ohne Koreanisch: ${table.api}`);
});

test('Tabellen-Namen: Augments ueber i18n, nur abweichende Namen, kein Englisch', () => {
  const bundle = {
    items: { A: { name: 'Pack' } }, champions: {}, traits: {},
    augments: { A: { name: 'Pack', i18n: { de: { name: 'Packung' }, en: { name: 'Pack' }, es: { name: 'Pack' }, xx: { name: 'Nein' } } } },
  };
  assert.deepEqual(lootTableNames({ api: 'A' }, bundle).byApi, { A: { de: 'Packung' } });
});

test('Waechter findet englische Namen nur, wo es eine Uebersetzung gibt', () => {
  const bundle = {
    items: { I: { name: "Rabadon's Cap", names: { ko: '모자' } }, Same: { name: 'Same' } },
    champions: { U: { name: 'Draven', names: { ko: '드레이븐' } } },
    traits: {},
  };
  assert.deepEqual(englishNamesIn('<div>Rabadon&#x27;s Cap</div><img alt="Draven"><b>Same</b>', 'ko', bundle), ["Rabadon's Cap", 'Draven']);
  assert.deepEqual(englishNamesIn('<div>모자</div><img alt="드레이븐">', 'ko', bundle), []);
  assert.deepEqual(englishNamesIn('<img alt="Draven">', 'de', bundle), []);
});

test('Echtes Bundle: Form der Namen, Abdeckung, Englisch unveraendert', () => {
  const a = JSON.parse(readFileSync(new URL('../../public/tft-assets.json', import.meta.url), 'utf8'));
  for (const k of ['items', 'champions', 'traits']) {
    for (const [id, e] of Object.entries(a[k])) {
      if (!e.names) continue;
      for (const [lang, v] of Object.entries(e.names)) {
        assert.ok(NAME_LANGS.includes(lang), `${id} ${lang}`);
        assert.ok(typeof v === 'string' && v.trim() && v !== e.name, `${id} ${lang}: ${v}`);
      }
    }
  }
  const named = Object.values(a.items).filter(i => i.names).length;
  // Kein Set-Literal: die Grenze folgt der Zahl aktiver Items.
  assert.ok(named >= a.active.items.length * 0.8, `nur ${named} Items mit Namen`);
});
