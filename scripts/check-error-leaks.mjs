#!/usr/bin/env node
// Waechter gegen Fehlertexte nach aussen (Sicherheitsdurchsicht 24.10.2026).
//
// Gut 30 oeffentliche Routen gaben `error: e.message` an den Browser — darin
// standen Antworttexte von Supabase (Funktionsname, Parameter, Body) und der
// Box. Seitdem laeuft das ueber publicError() (app/lib/public-error.ts):
// Rohtext ins Server-Log, fester Code nach aussen. Dieser Waechter haelt neue
// Stellen fern.
//
// Rein textlich und bewusst grob, wie check-write-routes.mjs: gemeldet wird
// jede Zeile in app/api/**/route.ts (ausser internal/, dort ist der Aufrufer
// angemeldet), die einen `.message`-Zugriff oder String(err) in eine
// Antwort-Eigenschaft (error/detail/details/message/reason) legt oder in eine
// Variable, die direkt danach als Antwort rausgeht. Zeilen mit publicError(
// und console.* zaehlen nicht.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FELD_MIT_ROHTEXT = /\b(error|detail|details|message|reason)\s*:\s*[^,}]*(\.message\b|String\(\s*(e|err|error)\s*\))/;
const VARIABLE_AUS_ROHTEXT = /^\s*(const|let)\s+(\w+)\s*=.*\.message\b/;

export function findLeaks(src) {
  const zeilen = src.split(/\r?\n/);
  const funde = [];
  zeilen.forEach((z, i) => {
    if (/publicError\(|console\.(error|warn|log|info)/.test(z)) return;
    if (/^\s*(\/\/|\*)/.test(z)) return;
    if (FELD_MIT_ROHTEXT.test(z) && !/throw new Error/.test(z)) {
      funde.push({ zeile: i + 1, text: z.trim() });
      return;
    }
    const v = z.match(VARIABLE_AUS_ROHTEXT);
    if (v) {
      const name = v[2];
      const danach = zeilen.slice(i + 1, i + 4).join('\n');
      if (new RegExp(`\\b(error|detail|details|message|reason)\\s*:\\s*${name}\\b`).test(danach)) {
        funde.push({ zeile: i + 1, text: z.trim() });
      }
    }
  });
  return funde;
}

function routen(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...routen(p));
    else if (e === 'route.ts') out.push(p);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const alle = routen(join('app', 'api')).map((p) => p.split(sep).join('/'))
    .filter((p) => !p.startsWith('app/api/internal/'));
  let n = 0;
  for (const p of alle) {
    for (const f of findLeaks(readFileSync(p, 'utf8'))) {
      if (n === 0) console.error('\nFEHLER: Fehlertext geht nach aussen (statt publicError):');
      n++;
      console.error(`  ${p}:${f.zeile}  ${f.text.slice(0, 140)}`);
    }
  }
  if (n > 0) {
    console.error('  Rohtext ins Log, festen Code nach aussen: publicError(wo, e, code) aus app/lib/public-error.ts.');
    process.exit(1);
  }
  console.log(`  Fehlertexte geprueft (${alle.length} Routen, keine Rohtexte nach aussen).`);
}
