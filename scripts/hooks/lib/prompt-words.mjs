// Was ein User-Prompt fuer die Disziplin-Hooks bedeutet: Freigabe, Trivial-
// Ausweg, neues Thema, Maschinen-Meldung. Reine Textlogik, testbar ohne Hook.
//
// Bis Runde 10 (24.10.2026) stand das doppelt: prompt-submit.mjs mit
// Laengengrenze, code-prompt-reviewer.mjs ohne. Folgen laut
// Sicherheitsdurchsicht: „Ist das trivial?" und „Ok, aber mach X anders" zaehlten
// als Freigabe (freigabe-aus-rueckfrage), und ein einziges „typo" irgendwo in
// einem langen Auftrag schaltete die Review-Erinnerung ab
// (trivial-marker-ohne-laengengrenze).

// `k`, `jo` und `mach` sind hier bewusst NICHT dabei: sie kamen in keiner der
// bisher erteilten Freigaben vor (`.git/metastats-discipline/*.json` am
// 2026-09-01: go, Go, "Ja und go", "Go B", "Go Freigabe", "Passt, …"), sind aber
// die haeufigsten Anfaenge normaler Auftraege („mach weiter mit X").
const APPROVAL = /^\s*(go|ok|okay|passt|freigabe|freigegeben|los|ja|yes|approved|genehmigt)\b/i;
const TRIVIAL = /\b(trivial|spot-?fix)\b/i;
const NEW_TOPIC = /^\s*code\s*:/i;
// Kurz genug, um eine reine Zustimmung zu sein. „ok, aber mach X anders" ist
// keine Freigabe des vorgelegten Plans, sondern ein neuer Auftrag.
const MAX_LAENGE = 120;
// Eine Rueckfrage oder ein Vorbehalt ist keine Zustimmung.
const VORBEHALT = /\b(aber|but|jedoch|allerdings|however|sondern|au(ss|ß)er|except)\b/i;
// Verneinung direkt vor dem Wort: „nicht trivial", „kein Spot-Fix", „not trivial".
const VERNEINT = /\b(nicht|kein|keine|keinen|keiner|nie|niemals|not|no|never|isn'?t)\s+((so|ganz|wirklich|mehr|eher|unbedingt|really|quite|exactly|a)\s+)?$/i;

/**
 * Nicht vom User: Subagent-Fertigmeldungen, Hook-Reminder, Bash-Echos. Sie
 * kommen ueber denselben Kanal an und duerfen niemals eine Freigabe erzeugen.
 * Belegt eingetreten (2026-09-01): eine 18k Zeichen lange Agent-Meldung enthielt
 * das Wort „trivial" und hat sich damit selbst freigegeben.
 */
export function isMachinePrompt(prompt) {
  return /^\s*</.test(String(prompt || ''));
}

/** Neuer `Code:`-Auftrag = neues Thema. */
export function isNewTopic(prompt) {
  return NEW_TOPIC.test(String(prompt || ''));
}

function kurzUndVorbehaltlos(p) {
  return p.length <= MAX_LAENGE && !p.includes('?') && !VORBEHALT.test(p);
}

/** „go", „Passt", „Code: ja" — kurz, ohne Frage, ohne Vorbehalt. */
export function isApprovalPrompt(prompt) {
  const p = String(prompt || '').trim();
  return kurzUndVorbehaltlos(p) && APPROVAL.test(p.replace(NEW_TOPIC, ''));
}

/**
 * Trivial-Ausweg. Dieselben Grenzen wie die Freigabe, dazu: das Wort darf nicht
 * verneint sein. `extra` = weitere Marker (der Review-Hinweis kennt auch „typo").
 */
export function isTrivialPrompt(prompt, extra = []) {
  const p = String(prompt || '').trim();
  if (!kurzUndVorbehaltlos(p)) return false;
  for (const re of [TRIVIAL, ...extra]) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of p.matchAll(g)) {
      if (!VERNEINT.test(p.slice(0, m.index))) return true;
    }
  }
  return false;
}
