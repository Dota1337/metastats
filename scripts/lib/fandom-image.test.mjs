import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fandomImagePath, fandomImageUrl, flatFandomFileName, normalizeFileName,
  checkFandomImage, repairFlatFandomLogos, FANDOM_IMAGE_BASE,
} from './fandom-image.mjs';

// Bekannte, live funktionierende Logos aus public/pro-teams.json — der berechnete
// Pfad muss exakt dem entsprechen, den Fandom selbst ausliefert.
test('md5-Unterordner stimmt fuer bekannte Logos', () => {
  assert.equal(fandomImagePath('T1logo_square.png'), 'a/a2/T1logo_square.png');
  assert.equal(fandomImagePath('G2 Esportslogo square.png'), '7/77/G2_Esportslogo_square.png');
  assert.equal(fandomImagePath('Gen.Glogo_square.png'), 'e/e3/Gen.Glogo_square.png');
  assert.equal(fandomImagePath('Fnaticlogo_square.png'), 'f/fc/Fnaticlogo_square.png');
});

test('Sonderzeichen werden wie bei MediaWiki kodiert', () => {
  assert.equal(fandomImagePath("Anyone's_Legendlogo_square.png").split('/').pop(), 'Anyone%27s_Legendlogo_square.png');
  assert.equal(fandomImagePath('LØSlogo_square.png').split('/').pop(), 'L%C3%98Slogo_square.png');
  assert.match(fandomImagePath('KaBuM! Ilha das Lendaslogo square.png'), /\/KaBuM%21_Ilha_das_Lendaslogo_square\.png$/);
  assert.match(fandomImagePath('Forsaken (Polish Team)logo square.png'), /\/Forsaken_%28Polish_Team%29logo_square\.png$/);
});

test('Normalform: erster Buchstabe gross, File:-Praefix weg, leer bleibt leer', () => {
  assert.equal(normalizeFileName('File:t1logo square.png'), 'T1logo_square.png');
  assert.equal(fandomImagePath(''), '');
  assert.equal(fandomImageUrl(null), null);
  assert.equal(fandomImageUrl('T1logo_square.png'), `${FANDOM_IMAGE_BASE}a/a2/T1logo_square.png/revision/latest`);
});

test('erkennt nur Adressen ohne Unterordner als kaputt', () => {
  assert.equal(flatFandomFileName(`${FANDOM_IMAGE_BASE}Team_WElogo_profile.png`), 'Team_WElogo_profile.png');
  assert.equal(flatFandomFileName(`${FANDOM_IMAGE_BASE}Rogue_(European_Team)logo_square.png`), 'Rogue_(European_Team)logo_square.png');
  assert.equal(flatFandomFileName(`${FANDOM_IMAGE_BASE}a/a2/T1logo_square.png/revision/latest?cb=1`), null);
  assert.equal(flatFandomFileName('https://am-a.akamaihd.net/image?x=1'), null);
  assert.equal(flatFandomFileName(null), null);
});

const fakeFetch = map => async url => {
  const r = map[url];
  if (r instanceof Error) throw r;
  return { status: r?.status ?? 404, headers: new Map([['content-type', r?.type ?? 'image/jpeg']]) };
};

test('checkFandomImage: 200 Bild ok, 404 Platzhalter missing, Rest error', async () => {
  const f = fakeFetch({
    a: { status: 200, type: 'image/webp' },
    b: { status: 404, type: 'image/jpeg' },
    c: { status: 403, type: 'text/html' },
    d: { status: 200, type: 'text/html' },
    e: new Error('netz'),
  });
  assert.equal(await checkFandomImage('a', { fetchImpl: f }), 'ok');
  assert.equal(await checkFandomImage('b', { fetchImpl: f }), 'missing');
  assert.equal(await checkFandomImage('c', { fetchImpl: f }), 'error');
  assert.equal(await checkFandomImage('d', { fetchImpl: f }), 'error');
  assert.equal(await checkFandomImage('e', { fetchImpl: f }), 'error');
});

test('repairFlatFandomLogos: repariert, setzt null, laesst gute Logos in Ruhe', async () => {
  const good = `${FANDOM_IMAGE_BASE}a/a2/T1logo_square.png/revision/latest?cb=1`;
  const teams = [
    { name: 'T1', logo: good },
    { name: 'G2', logo: `${FANDOM_IMAGE_BASE}G2_Esportslogo_square.png` },
    { name: 'Weg', logo: `${FANDOM_IMAGE_BASE}Gibtsnichtlogo_square.png` },
    { name: 'Ohne', logo: null },
  ];
  const calls = [];
  const f = async url => {
    calls.push(url);
    return url === fandomImageUrl('G2_Esportslogo_square.png')
      ? { status: 200, headers: new Map([['content-type', 'image/png']]) }
      : { status: 404, headers: new Map([['content-type', 'image/jpeg']]) };
  };
  const s = await repairFlatFandomLogos(teams, { fetchImpl: f, pauseMs: 0 });
  assert.deepEqual({ checked: s.checked, repaired: s.repaired, nulled: s.nulled }, { checked: 2, repaired: 1, nulled: 1 });
  assert.equal(teams[0].logo, good);
  assert.equal(teams[1].logo, `${FANDOM_IMAGE_BASE}7/77/G2_Esportslogo_square.png/revision/latest`);
  assert.equal(teams[2].logo, null);
  assert.equal(teams[3].logo, null);
  assert.equal(calls.length, 2);
});
