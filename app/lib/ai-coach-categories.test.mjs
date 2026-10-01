// Drift-Waechter: jeder deutsche Coach-Text aus ai-coach-categories.ts hat einen
// Uebersetzungs-Eintrag in i18n.tsx, dessen deutsche Spalte exakt gleich ist.
// Sonst zeigt die englische/koreanische/... Seite einen veralteten Text oder
// faellt still auf Deutsch zurueck.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROLE_CATEGORIES, ROLE_TIPS, TIP_NONE, TIP_FOCUS, getImprovementTip } from './ai-coach-categories.ts';

const i18n = readFileSync(new URL('./i18n.tsx', import.meta.url), 'utf8');
const ROLES = ['TOP', 'JUNGLE', 'MID', 'BOTTOM', 'SUPPORT'];

// DE-Spalte eines Schluessels aus dem Quelltext lesen (\uXXXX zurueckwandeln)
function deOf(key) {
  const start = i18n.indexOf(`'${key}': t6('`);
  if (start < 0) return null;
  const m = i18n.slice(start + key.length + 8).match(/^((?:[^'\\]|\\.)*)'/);
  return m ? JSON.parse(`"${m[1].replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) : null;
}

function pairs() {
  const out = [];
  for (const role of ROLES) {
    for (const c of ROLE_CATEGORIES[role]) {
      out.push([`coach.${role}.${c.key}.title`, c.name]);
      out.push([`coach.${role}.${c.key}.good`, c.advice.good]);
      out.push([`coach.${role}.${c.key}.bad`, c.advice.bad]);
    }
  }
  for (const [role, tips] of Object.entries(ROLE_TIPS)) {
    for (const [k, v] of Object.entries(tips)) out.push([`coach.tip.${role}.${k}`, v]);
  }
  out.push(['coach.tip.none', TIP_NONE], ['coach.tip.focus', TIP_FOCUS]);
  return out;
}

test('jeder Coach-Text hat einen Schluessel mit identischer deutscher Spalte', () => {
  const all = pairs();
  assert.ok(all.length > 90, `nur ${all.length} Texte gefunden`);
  for (const [key, de] of all) assert.equal(deOf(key), de, `Schluessel ${key}`);
});

test('jede Tipp-Rolle ist eine der fuenf normalisierten Rollen', () => {
  for (const role of Object.keys(ROLE_TIPS)) assert.ok(ROLES.includes(role), role);
});

test('getImprovementTip liefert Schluessel fuer alle drei Ausgaenge', () => {
  assert.equal(getImprovementTip('TOP', []).key, 'none');
  assert.equal(getImprovementTip('TOP', [{ category: 'csPerMin', title: 'CS-Effizienz' }]).key, 'TOP.csPerMin');
  const focus = getImprovementTip('TOP', [{ category: 'kda', title: 'KDA' }]);
  assert.equal(focus.key, 'focus:kda');
  assert.ok(focus.text.includes('KDA'));
});
