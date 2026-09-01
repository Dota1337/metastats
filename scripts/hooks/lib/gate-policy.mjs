// Policy-Kern des Schreib-Gates. Bewusst frei von stdin, process.exit und
// Hook-JSON: das hier ist der testbare Teil, `write-gate.mjs` ist nur Glue.
//
// Warum getrennt: `planQuality()` ist reine Textlogik mit Regex-Vorgeschichte,
// und `pathsWrittenByShell()` muss gegen echte Kommandozeilen aus dem Transcript
// geprueft werden koennen. Ein Hook-Entry-Point laesst sich nicht unit-testen,
// diese Funktionen schon — dieselbe Aufteilung wie bei `state.mjs` +
// `state.test.mjs`.

import { readFileSync } from 'node:fs';
import { relative, isAbsolute, resolve } from 'node:path';

// --------------------------------------------------------------- Freistellungen

/**
 * Pfade, die das Gate nichts angehen. Uebernommen aus plan-gate.mjs, erweitert
 * um die zwei Freistellungen, ohne die sich das Gate selbst einsperrt
 * (logic-flow-critic F1, 2026-09-01): seinen eigenen Quellcode und die
 * Hook-Registrierung. Ohne die beiden ist der im Plan genannte Rollback
 * ("Austragen aus hooks.json") von innen nicht ausfuehrbar.
 */
export function isExempt(rel) {
  if (rel == null) return true;
  // Leerer relativer Pfad = die Projektwurzel selbst. Das ist der Fall bei
  // Kommandos, die den ganzen Baum anfassen (`git reset --hard`, `git clean`),
  // und der darf gerade NICHT als freigestellt durchgehen.
  if (rel === '') return false;
  if (rel.startsWith('..') || isAbsolute(rel)) return true;      // ausserhalb des Projekts
  if (rel.startsWith('.claude/') || rel.startsWith('.git/')) return true;
  if (rel === 'AGENTS.md' || rel === 'CLAUDE.md') return true;
  // Der eigene Reparaturpfad. Ein Logikfehler im Gate schreibt sauberes
  // "deny" und Exit 0 — das ist KEIN Absturz und faellt deshalb nicht offen
  // aus. Ohne diese Zeile waere der Fix am Gate selbst gesperrt.
  if (rel.startsWith('scripts/hooks/')) return true;
  if (rel === 'infra/claude-settings/hooks.json') return true;
  // Notizen und Doku ausserhalb des Codes.
  if (/\.(md|txt)$/i.test(rel) && !/^(app|scripts|infra)\//.test(rel)) return true;
  // Regel- und Spec-Prosa unter infra/ (User-Entscheidung 2026-08-17).
  // infra/claude-agents/ bleibt bewusst gesperrt.
  if (/^infra\/(claude-settings|specs)\/.+\.md$/i.test(rel)) return true;
  return false;
}

/** Absoluter oder relativer Pfad -> projekt-relativ mit Vorwaerts-Slashes. */
export function toRel(file, projectDir, base = projectDir) {
  if (!file) return '';
  const abs = isAbsolute(file) ? resolve(file) : resolve(base, file);
  return relative(projectDir, abs).replace(/\\/g, '/');
}

// ------------------------------------------------------------------ Plan-Pruefung

export function planQuality(planFile, read = readFileSync) {
  let text;
  try {
    text = read(planFile, 'utf8');
  } catch (err) {
    // Nur "Datei fehlt" ist ein Plan-Problem. Alles andere (Bug hier, Rechte,
    // kaputter Symlink) darf sich nicht als "kein Plan" tarnen.
    if (err?.code === 'ENOENT') return { ok: false, why: 'keine Plan-Datei' };
    return { ok: true, note: `Plan-Pruefung uebersprungen: ${err?.message || err}` };
  }

  const hasVerdictHeading = /^#{1,4}\s*verdicts?\b/im.test(text);
  const AGENT = /\b(metastats-[a-z-]+|classification-reviewer|Explore)\b/i;
  const verdictLines = text.split('\n')
    .filter((l) => AGENT.test(l) && /[-*|]/.test(l.trim()[0] || ''));
  if (!hasVerdictHeading || !verdictLines.length) {
    return { ok: false, why: 'kein "## Verdicts"-Block mit mindestens einem Agent-Verdict' };
  }

  const tableRows = text.split('\n')
    .filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s|:-]+\|?\s*$/.test(l)).length;
  const numbered = (text.match(/^\s*(\d+[.)]|[A-C]\))\s+\S/gm) || []).length;
  if (Math.max(tableRows - 1, numbered) < 3) {
    return { ok: false, why: 'weniger als 3 Alternativen mit Trade-offs im Plan' };
  }
  return { ok: true };
}

// -------------------------------------------------- Schreibpfade aus Shell-Zeilen

// Kommandos, deren REST an eine andere Maschine oder in einen Container geht.
// Deren Pfade sehen aus wie lokale Absolutpfade (`sed -i /opt/metastats-crawler/x`)
// und wuerden sonst falsch gegen PROJECT_DIR aufgeloest.
const REMOTE = /^(ssh|scp|rsync|docker|kubectl|vercel|gh)\b/;
// Interpreter mit Inline-Code: hier zaehlt der Code-Inhalt, nicht das Argument.
const INLINE = /^(node|bash|sh|zsh|python3?)\b/;
const WRITE_CALLS = /\b(writeFileSync|appendFileSync|unlinkSync|renameSync|rmSync|mkdirSync|copyFileSync|createWriteStream|\.write\()/;

const FILE_ARG = /^[^-|&;<>]\S*$/;

function splitSegments(cmd) {
  // Grob an den ueblichen Trennern zerlegen. Bewusst kein Shell-Parser: bei
  // Konstrukten, die das ueberfordern ($VAR, xargs, Pipes in Skripte), soll das
  // Gate lieber durchlassen als falsch blocken — ein Hook, der bei Kleinigkeiten
  // nervt, wird abgeschaltet (reference_quality_gates.md).
  return cmd.split(/\n|&&|\|\||;/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Liefert { paths: string[], base: string } — Kandidaten fuer geschriebene
 * Dateien, bereits relativ zum jeweils gueltigen Arbeitsverzeichnis aufgeloest.
 * `readScript` erlaubt es dem Test, Skript-Inhalte zu stellen.
 */
export function pathsWrittenByShell(cmd, projectDir, readScript = readFileSync) {
  const out = [];
  if (!cmd) return out;
  let base = projectDir;

  for (const seg of splitSegments(cmd)) {
    const m = seg.match(/^cd\s+(?:--\s+)?(['"]?)([^'"]+)\1\s*$/);
    if (m) {                                    // `cd x && ...` setzt die Basis
      base = isAbsolute(m[2]) ? resolve(m[2]) : resolve(base, m[2]);
      continue;
    }
    if (REMOTE.test(seg)) continue;             // laeuft nicht auf dieser Platte

    const push = (p) => { if (p) out.push({ path: p, base }); };

    // Redirects: `> datei`, `>> datei`, Heredoc-Ziel `cat > datei <<EOF`.
    // `2>&1` und `>/dev/null` sind keine Schreibziele im Projekt.
    for (const r of seg.matchAll(/(?:^|\s)\d?>>?\s*(['"]?)([^\s'"|&;<]+)\1/g)) {
      if (r[2] === '/dev/null' || r[2].startsWith('&')) continue;
      push(r[2]);
    }

    const words = seg.split(/\s+/);
    const head = words[0];

    if (/^(sed|perl)$/.test(head) && /\s-[a-zA-Z]*i\b/.test(seg)) {
      // Das erste Nicht-Options-Argument ist der Ausdruck (`s/a/b/`), nicht die
      // Datei — ohne diese Unterscheidung wird `s/a/b` als Pfad geblockt.
      const args = words.slice(1).filter((w) => !w.startsWith('-') && FILE_ARG.test(w));
      for (const w of args.slice(1)) push(w);
    } else if (/^(cp|mv|ln|install)$/.test(head)) {
      const args = words.slice(1).filter((w) => !w.startsWith('-'));
      push(args[args.length - 1]);              // nur das Ziel
    } else if (/^(rm|touch|mkdir|truncate|tee|chmod|chown)$/.test(head)) {
      for (const w of words.slice(1)) if (!w.startsWith('-')) push(w);
    } else if (head === 'git') {
      // Nur die Unterbefehle, die Dateien im Baum ueberschreiben.
      if (/^git\s+(checkout\s+--|restore|apply|stash\s+pop|reset\s+--hard|clean\s+-[a-z]*f)/.test(seg)) {
        push('.');
      }
    } else if (/^(Set-Content|Out-File|Add-Content|Remove-Item|New-Item|Move-Item|Copy-Item|Rename-Item|Set-ItemProperty)$/i.test(head)) {
      // PowerShell-Kanal: gemessen 161 Aufrufe, war in der ersten Fassung offen.
      for (const w of words.slice(1)) if (FILE_ARG.test(w) && !w.startsWith('-')) push(w);
    } else if (INLINE.test(head)) {
      // `node -e "..."` / `node script.mjs`: nicht der Aufruf entscheidet,
      // sondern ob der ausgefuehrte Code ueberhaupt schreibt. 759 der
      // gemessenen Bash-Aufrufe sind `node -e`, die meisten davon rein lesend.
      const inline = seg.match(/-e\s+(['"])([\s\S]*?)\1/);
      if (inline) {
        if (WRITE_CALLS.test(inline[2])) push('.');
        continue;
      }
      const script = words.slice(1).find((w) => /\.(mjs|cjs|js|ts|sh|py)$/.test(w));
      if (script) {
        const abs = isAbsolute(script) ? script : resolve(base, script);
        let body = '';
        try { body = readScript(abs, 'utf8'); } catch { body = ''; }
        // Nicht lesbar (Scratchpad, generiert): nicht blocken. Lesbar und
        // schreibend: als Schreibzugriff auf das Projekt werten.
        if (body && WRITE_CALLS.test(body)) push('.');
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------- Deny-Text

export function denyText(what, reason, planExists) {
  return `Schreiben auf ${what} ohne freigegebenen Plan blockiert (${reason}).

So kommst du weiter — in dieser Reihenfolge, ohne Abkuerzung:
1. Schreib den Plan nach .claude/plan-current.md${planExists ? ' (existiert bereits — ueberschreiben)' : ''}:
   Ziel in einem Satz · betroffene Dateien · >=3 Alternativen mit Trade-offs ·
   gewaehlte Option mit Begruendung · wie du das Ergebnis pruefst.
2. Spawne die passenden Review-Agents (AGENTS.md) und schreib ihre Verdicts
   unter eine Ueberschrift "## Verdicts" in denselben Plan — eine Zeile pro
   Agent, beginnend mit "- " oder in einer Tabelle. Ohne diesen Block oeffnet
   das Gate auch MIT Freigabe nicht.
3. Zeig dem User den Kern des Plans (kurz) und WARTE auf Freigabe.
4. Der User gibt frei mit: go / ok / passt / freigabe / los.
   Erst dann oeffnet dieses Gate — automatisch, du musst nichts weiter tun.

Trivial-Ausweg (nur wenn es wirklich zutrifft): der User schreibt "trivial"
oder "spot-fix" in seinen Prompt. Das entscheidest NICHT du.

Notausgang, falls dieses Gate selbst kaputt ist: WRITE_GATE=0 in der Umgebung.`;
}
