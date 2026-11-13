// Ausfall von CommunityDragon im TFT-Daten-Lauf (User 13.11.2026, Auswahl „Gruen,
// Alarm nach 24 h“): antwortet CDragon nicht, endet der Lauf gruen und die alten Daten
// bleiben. Gemeldet wird erst, wenn der Ausfall laenger dauert.
//
// Merker ist ein Issue mit eigenem Label, Muster wie failure-watch und der Report
// (Zustand im versteckten Marker im Text):
// - erster Ausfall-Lauf: Issue still anlegen (ohne Zuweisung = keine Mail, das Repo
//   hat keine Beobachter, gh-issues.mjs), Beginn im Marker
// - ab `alarmHours` dem Besitzer zuweisen = genau eine Mail
// - liefert CDragon wieder: still schliessen
// Verworfen: Laeufe per API zurueckverfolgen (neue Berechtigung, Kette bricht an
// Leerlaeufen und fremden Fehlern), Cache, Feld im Bundle (Deploy je Ausfall).
//
// Das Label steht auch in tft-data-refresh.yml („Letzten Lauf lesen“): ein offenes
// Issue ist dort ein Grund fuer den naechsten Versuch.

import { assignOwner, closeIssue, createIssue, editIssue, ensureLabel, listIssues, sameLogin } from './gh-issues.mjs';

export const OUTAGE_LABEL = 'tft-cdragon-down';
const MARK = /<!-- cdragon-down since:(\S+) -->/;

export const sinceOf = body => MARK.exec(body ?? '')?.[1] ?? null;

/**
 * Reine Entscheidung. `delivered`: das Bundle kam durch; `sourceDown`: CDragon antwortete
 * nicht. Rueckgabe: { action: none|create|assign|close, since?, assignNow? }.
 */
export function decideOutage({ sourceDown, delivered, open, owner, nowMs, alarmHours }) {
  if (delivered) return { action: open ? 'close' : 'none' };
  if (!sourceDown) return { action: 'none' };
  if (!open) return { action: 'create', since: new Date(nowMs).toISOString(), assignNow: alarmHours <= 0 };
  const since = sinceOf(open.body);
  // Ohne Marker (von Hand angelegt) fehlt der Beginn: nicht anfassen.
  if (!since || Number.isNaN(Date.parse(since))) return { action: 'none' };
  if ((open.assignees ?? []).some(a => sameLogin(a, owner))) return { action: 'none' };
  return nowMs - Date.parse(since) >= alarmHours * 3_600_000 ? { action: 'assign', since } : { action: 'none' };
}

const mez = iso => new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso));

export function issueText({ since, runUrl }) {
  return {
    title: `CommunityDragon nicht erreichbar seit ${mez(since)}`,
    body: [
      `CommunityDragon antwortet seit ${mez(since)} Uhr nicht, die Spieldaten (Namen, Texte, Zahlen) werden nicht aktualisiert.`,
      'Die Seite zeigt weiter den letzten erfolgreichen Stand. Antwortet CommunityDragon wieder, laeuft alles von selbst weiter und dieses Issue schliesst sich.',
      '',
      `Letzter Lauf: ${runUrl ?? ''}`,
      '',
      `<!-- cdragon-down since:${since} -->`,
      '',
    ].join('\n'),
  };
}

/** Fuehrt die Entscheidung aus. `gh` aus makeGh. Rueckgabe: die Aktion. */
export async function syncOutage({ gh, owner, sourceDown, delivered, nowMs, alarmHours, runUrl, log = console.log }) {
  if (!sourceDown && !delivered) return 'none';
  const open = (await listIssues(gh, { label: OUTAGE_LABEL }))[0] ?? null;
  const d = decideOutage({ sourceDown, delivered, open, owner, nowMs, alarmHours });
  if (d.action === 'create') {
    await ensureLabel(gh, { name: OUTAGE_LABEL, color: 'FBCA04', description: 'CommunityDragon antwortet nicht (TFT-Daten-Lauf)' });
    const issue = await createIssue(gh, { ...issueText({ since: d.since, runUrl }), labels: [OUTAGE_LABEL] });
    if (d.assignNow) {
      const why = await assignOwner(gh, issue.number, owner);
      if (why) log(`::warning::Ausfall-Issue nicht zugewiesen: ${why}`);
    }
  } else if (d.action === 'assign') {
    // Text zuerst: die Mail zur Zuweisung zeigt ihn.
    await editIssue(gh, open.number, issueText({ since: d.since, runUrl }));
    const why = await assignOwner(gh, open.number, owner);
    if (why) log(`::warning::Ausfall-Issue nicht zugewiesen: ${why}`);
  } else if (d.action === 'close') {
    await closeIssue(gh, open.number);
  }
  return d.action;
}
