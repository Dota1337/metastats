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

import { pickAccount, combineLookups, nameKey, riotIdKey, splitRiotId, toHead, playerCanonicalName, DIRECTORY_LIMIT } from './player-lookup.ts';

const acc = (gameName, tagLine, region = 'euw1') => ({ puuid: `${gameName}-${tagLine}`, gameName, tagLine, region, tier: null, division: null, lp: null });

test('TFT: Tag ohne Gross/Klein und Leerraum am Rand trifft', () => {
  const hits = [acc('Faker', 'KR1', 'kr'), acc('Faker', 'EUW')];
  assert.deepEqual(pickAccount(hits, 'euw'), { known: true, value: hits[1] });
  assert.deepEqual(pickAccount([acc('Faker', 'EUW ')], ' euw'), { known: true, value: acc('Faker', 'EUW ') });
});

test('TFT: Name bekannt, Tag nicht → unbekannt; keine Treffer → unbekannt', () => {
  assert.deepEqual(pickAccount([acc('Faker', 'KR1')], 'NA1'), { known: false });
  assert.deepEqual(pickAccount([], 'EUW'), { known: false });
});

test('TFT: Zweifel → keine Entscheidung (Fehler, kein Tag, volle Liste)', () => {
  assert.equal(pickAccount(null, 'EUW'), null, 'Abfrage gescheitert');
  assert.equal(pickAccount([acc('Faker', 'EUW')], ''), null, 'kein Tag');
  assert.equal(pickAccount([acc('Faker', 'EUW')], '   '), null, 'Tag nur Leerraum');
  const full = Array.from({ length: DIRECTORY_LIMIT }, (_, i) => acc('karmaaaz', `T${i}`));
  assert.equal(pickAccount(full, 'GESUCHT'), null, 'Liste voll: das Konto kann dahinter liegen');
  assert.deepEqual(pickAccount(full, 't5'), { known: true, value: full[5] }, 'Treffer in voller Liste zaehlt');
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

test('Schluessel: „KR 1“ und „KR1“ sind zwei Konten (Speicher, Profi-Liste), Rand egal', () => {
  assert.notEqual(riotIdKey('Faker', 'KR 1'), riotIdKey('Faker', 'KR1'));
  assert.equal(riotIdKey('Faker', ' kr 1 '), riotIdKey('faker', 'KR 1'));
  assert.deepEqual(pickAccount([acc('Faker', 'KR1'), acc('Faker', 'KR 1')], 'kr 1'), { known: true, value: acc('Faker', 'KR 1') });
});

test('canonical-Schreibweise: Quelle nur bei sicher gleicher Riot-ID, sonst Adresse', () => {
  const head = (gameName, tagLine) => ({ known: true, gameName, tagLine });
  // Gross/Klein und Leerraum im Namen: Schreibweise der Quelle.
  assert.deepEqual(playerCanonicalName(head('Hide on bush', 'KR1'), 'hideonbush', 'kr1'), { gameName: 'Hide on bush', tagLine: 'KR1' });
  // Anderer Tag (Leerzeichen innen) oder Vollbreite: Adresse gewinnt.
  assert.deepEqual(playerCanonicalName(head('Faker', 'KR1'), 'Faker', 'KR 1'), { gameName: 'Faker', tagLine: 'KR 1' });
  assert.deepEqual(playerCanonicalName(head('Ｈｙｕｎｄａｉ', '9580'), 'Hyundai', '9580'), { gameName: 'Hyundai', tagLine: '9580' });
  // Rand gekuerzt, auch in der Quelle.
  assert.deepEqual(playerCanonicalName(head(' ViggoZe ', 'EUW '), 'viggoze', 'euw'), { gameName: 'ViggoZe', tagLine: 'EUW' });
  assert.deepEqual(playerCanonicalName(null, ' ViggoZe', 'EUW '), { gameName: 'ViggoZe', tagLine: 'EUW' });
  // Unbekannt (noindex) behaelt die eigene Adresse; ohne Tag oder Name kein canonical.
  assert.deepEqual(playerCanonicalName({ known: false }, 'X', 'EUW'), { gameName: 'X', tagLine: 'EUW' });
  assert.equal(playerCanonicalName(null, 'Faker', ''), null);
  assert.equal(playerCanonicalName(head('Faker', 'KR1'), 'Faker', '  '), null);
  assert.equal(playerCanonicalName(null, ' ', 'EUW'), null);
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

test('DIRECTORY_LIMIT passt zum Deckel beider Namens-RPCs (sonst wird „Liste voll“ nie erkannt → falsches noindex)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  for (const fn of ['search_tft_player_names_exact', 'search_lol_player_names_exact']) {
    const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
      .filter(f => new RegExp(`function public\\.${fn}\\s*\\(`).test(readFileSync(new URL(f, dir), 'utf8')));
    assert.ok(files.length > 0, `keine Migration definiert ${fn}`);
    const sql = readFileSync(new URL(files.at(-1), dir), 'utf8');
    // Nur der Rumpf DIESER Funktion (0122 definiert mehrere).
    const body = sql.slice(sql.search(new RegExp(`function public\\.${fn}\\s*\\(`)));
    const cap = /limit\s+least\(greatest\(coalesce\(p_limit,\s*\d+\),\s*1\),\s*(\d+)\)/.exec(body)?.[1];
    assert.ok(cap, `${fn}: Deckel in ${files.at(-1)} nicht gefunden — Test an die neue Form anpassen`);
    assert.equal(Number(cap), DIRECTORY_LIMIT, `${fn} (${files.at(-1)}): Deckel ${cap}, Code fragt ${DIRECTORY_LIMIT}`);
  }
});
