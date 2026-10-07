// Anleitungs-Abdeckung der Comp-Liste: welcher Anteil der gespielten Comps
// bekommt auf der Seite eine MetaTFT-Anleitung?
//
// Gemessen wird an der Antwort der Companion-Route (/api/companion/v1/comps),
// die je Comp das Ergebnis derselben Zuordnung (resolveGuideId) als `guideId`
// mitliefert wie die Comp-Seite. Bis 08.10.2026 zaehlte der Vertrag nur exakte
// familyMap-Treffer und lag damit rund 20 Punkte unter dem, was Besucher sehen
// (68,2 % gemeldet, 88,9 % auf der Seite) — Fehlalarm-Mails (Issue #19).
//
// Genutzt vom Laufzeit-Vertrag `metatft-comps/familien-abdeckung` und von
// `npm run verify:coverage`, damit beide dieselbe Zahl nennen.

/** Volumen-Abdeckung einer Companion-Antwort. Luecken nach Spielen absteigend. */
export function measureGuideCoverage(body) {
  const comps = Array.isArray(body?.comps) ? body.comps : [];
  let totalGames = 0;
  let coveredGames = 0;
  let coveredFamilies = 0;
  const gaps = [];
  for (const c of comps) {
    const games = Number(c.games) || 0;
    totalGames += games;
    if (c.guideId) {
      coveredGames += games;
      coveredFamilies++;
    } else {
      gaps.push({ key: c.key, name: c.name || c.key, games });
    }
  }
  gaps.sort((a, b) => b.games - a.games);
  return {
    totalGames,
    coveredGames,
    ratio: totalGames > 0 ? coveredGames / totalGames : null,
    families: comps.length,
    coveredFamilies,
    gaps,
  };
}

const pct = (x) => `${(x * 100).toFixed(1)} %`;

/**
 * Bewertet eine Companion-Antwort. Reihenfolge der Pruefungen: Fehlerantwort,
 * falsches Set, keine Anleitungs-Datei, zu wenige Comps, dann die Abdeckung.
 * Eine alte Antwort (Zwischenspeicher haengt) stuft ein gruenes Ergebnis auf
 * `warn` herunter, ein rotes bleibt rot.
 *
 * @returns {{ status: 'ok'|'warn'|'broken', detail: string, coverage: object|null }}
 */
export function evaluateGuideCoverage(body, {
  set, minRatio, warnRatio, minFamilies, maxAgeHours = 8, now = Date.now(),
}) {
  const res = (status, detail, coverage = null) => ({ status, detail, coverage });
  if (!body || typeof body !== 'object') return res('broken', 'Antwort ist kein JSON-Objekt');
  if (body.error) return res('broken', `Route meldet Fehler „${body.error}“`);
  if (!Array.isArray(body.comps)) return res('broken', 'Antwort hat keine Comp-Liste');
  if (Number(body.set) !== Number(set)) {
    return res('broken', `Route liefert Set ${body.set}, erwartet Set ${set} (public/tft-set.json)`);
  }
  // undefined = Route ohne das Feld (alter Stand), null = keine Datei fuer das Set.
  if (body.guides === undefined) return res('broken', 'Antwort ohne Feld guides — Route auf altem Stand?');
  if (body.guides === null) {
    return res('broken', `keine MetaTFT-Datei für Set ${set} auf der Seite — keine Comp hat eine Anleitung`);
  }
  if (Number(body.guides.set) !== Number(set)) {
    return res('broken', `MetaTFT-Datei ist für Set ${body.guides.set}, erwartet Set ${set}`);
  }

  const cov = measureGuideCoverage(body);
  if (cov.families < minFamilies) {
    return res('broken',
      `nur ${cov.families} Comps in der Liste (min ${minFamilies}) — zu dünne Datenlage für eine Abdeckungs-Aussage, Set ${set}`,
      cov);
  }
  if (cov.ratio == null) return res('broken', 'Comp-Liste ohne Spiele', cov);

  const stand = `${pct(cov.ratio)} der Spiele mit Anleitung (Warnung unter ${pct(warnRatio)}, Bruch unter ${pct(minRatio)}), `
    + `${cov.coveredFamilies}/${cov.families} Comps, Set ${set}, MetaTFT-Stand ${String(body.guides.fetchedAt).slice(0, 10)}`;
  const worst = cov.gaps.slice(0, 3).map((g) => `${g.name} (${g.games})`).join(', ');
  const gapText = worst ? ` — grösste Lücken: ${worst}` : '';

  if (cov.ratio < minRatio) return res('broken', `nur ${stand}${gapText}`, cov);
  if (cov.ratio < warnRatio) return res('warn', `${stand}${gapText}`, cov);

  const ageH = (now - Date.parse(body.generatedAt)) / 3_600_000;
  if (!(ageH <= maxAgeHours)) {
    return res('warn', `${stand} — Antwort ist ${Number.isNaN(ageH) ? 'ohne Zeitstempel' : `${ageH.toFixed(1)} h alt`} (max ${maxAgeHours} h)`, cov);
  }
  return res('ok', stand, cov);
}
