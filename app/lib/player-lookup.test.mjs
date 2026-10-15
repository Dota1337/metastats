/**
 * Kennen wir einen Spieler? (player-lookup.ts, SEO-Plan Schritt 7)
 *
 * Der teure Fehler ist ein „unbekannt“, wo wir es nicht wissen: daraus wird
 * noindex, und eine echte Spielerseite faellt aus Google. Deshalb muss jeder
 * Zweifel (Fehler, kein Tag, volle Trefferliste, eine Quelle schweigt) „keine
 * Entscheidung“ (null) ergeben.
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { pickTftAccount, combineLookups, nameKey, riotIdKey, splitRiotId, toHead, DIRECTORY_LIMIT } from './player-lookup.ts';

const acc = (gameName, tagLine, region = 'euw1') => ({ puuid: `${gameName}-${tagLine}`, gameName, tagLine, region, tier: null, division: null, lp: null });

test('TFT: Tag ohne Gross/Klein und Leerraum am Rand trifft', () => {
  const hits = [acc('Faker', 'KR1', 'kr'), acc('Faker', 'EUW')];
  assert.deepEqual(pickTftAccount(hits, 'euw'), { known: true, value: hits[1] });
  assert.deepEqual(pickTftAccount([acc('Faker', 'EUW ')], ' euw'), { known: true, value: acc('Faker', 'EUW ') });
});

test('TFT: Name bekannt, Tag nicht → unbekannt; keine Treffer → unbekannt', () => {
  assert.deepEqual(pickTftAccount([acc('Faker', 'KR1')], 'NA1'), { known: false });
  assert.deepEqual(pickTftAccount([], 'EUW'), { known: false });
});

test('TFT: Zweifel → keine Entscheidung (Fehler, kein Tag, volle Liste)', () => {
  assert.equal(pickTftAccount(null, 'EUW'), null, 'Abfrage gescheitert');
  assert.equal(pickTftAccount([acc('Faker', 'EUW')], ''), null, 'kein Tag');
  assert.equal(pickTftAccount([acc('Faker', 'EUW')], '   '), null, 'Tag nur Leerraum');
  const full = Array.from({ length: DIRECTORY_LIMIT }, (_, i) => acc('karmaaaz', `T${i}`));
  assert.equal(pickTftAccount(full, 'GESUCHT'), null, 'Liste voll: das Konto kann dahinter liegen');
  assert.deepEqual(pickTftAccount(full, 't5'), { known: true, value: full[5] }, 'Treffer in voller Liste zaehlt');
});

test('LoL: eine Quelle kennt ihn → bekannt, egal was die anderen sagen', () => {
  const hit = { known: true, value: { gameName: 'Hide on bush', tagLine: 'KR1' } };
  assert.deepEqual(combineLookups([{ known: false }, null, hit]), hit);
  assert.deepEqual(combineLookups([hit, { known: false }, { known: false }]), hit);
});

test('LoL: unbekannt nur, wenn ALLE sicher nein sagen', () => {
  assert.deepEqual(combineLookups([{ known: false }, { known: false }, { known: false }]), { known: false });
  assert.equal(combineLookups([{ known: false }, null, { known: false }]), null, 'eine Quelle schweigt');
  assert.equal(combineLookups([null, null, null]), null);
  assert.equal(combineLookups([]), null);
});

test('Schluessel wie tft_name_norm: Gross/Klein und Leerraum egal, NFKC', () => {
  assert.equal(nameKey('Hide on bush'), 'hideonbush');
  assert.equal(nameKey('ＦＡＫＥＲ'), 'faker', 'Vollbreite → NFKC');
  assert.equal(riotIdKey('Hide On Bush', 'kr1'), riotIdKey('hideonbush', 'KR1'));
});

test('Riot-ID am letzten # getrennt, ohne Tag null', () => {
  assert.deepEqual(splitRiotId('A#B#KR1'), { gameName: 'A#B', tagLine: 'KR1' });
  assert.equal(splitRiotId('Faker'), null);
  assert.equal(splitRiotId('Faker#'), null);
  assert.equal(splitRiotId('#KR1'), null);
});

test('Kopf fuer den Client: nur Name + Tag, keine weiteren Felder', () => {
  assert.deepEqual(toHead({ known: true, value: { gameName: 'Faker', tagLine: 'KR1', extra: 1 } }), { known: true, gameName: 'Faker', tagLine: 'KR1' });
  assert.deepEqual(toHead({ known: false }), { known: false });
  assert.equal(toHead(null), null);
});

test('DIRECTORY_LIMIT passt zum Deckel der Namens-RPC (sonst wird „Liste voll“ nie erkannt → falsches noindex)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    .filter(f => /function public\.search_tft_player_names_exact\s*\(/.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.ok(files.length > 0, 'keine Migration definiert search_tft_player_names_exact');
  const sql = readFileSync(new URL(files.at(-1), dir), 'utf8');
  const cap = /limit\s+least\(greatest\(coalesce\(p_limit,\s*\d+\),\s*1\),\s*(\d+)\)/.exec(sql)?.[1];
  assert.ok(cap, `Deckel in ${files.at(-1)} nicht gefunden — Test an die neue Form anpassen`);
  assert.equal(Number(cap), DIRECTORY_LIMIT, `${files.at(-1)}: Deckel ${cap}, Code fragt ${DIRECTORY_LIMIT}`);
});
