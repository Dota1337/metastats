<!--
Quelle der Kernregeln, die pro Turn (UserPromptSubmit) und nach jedem Compact
(PostCompact) neu in den Kontext gespielt werden.

Warum hier und nicht in AGENTS.md: AGENTS.md steht am KOPF des Kontexts. In
langen Sessions verliert der Kopf gegen die Rezenz, und nach einem Auto-Compact
(gemessen: 20 Compacts in 6 Sessions, 14 davon in einer einzigen) faellt er
ganz weg. Dieser Text wird stattdessen ans ENDE gehaengt — an die Stelle, an
der er tatsaechlich wirkt.

Kurz halten. Jede Zeile kostet in JEDEM Turn. Nur Verbote, die messbar
verletzt wurden, gehoeren hier rein — keine Prosa, keine Begruendungen.
-->
## Kernregeln (pro Turn eingespielt, nicht verhandelbar)

**RANG 1 — Verifizieren vor Behaupten.** Ein Subagent-Verdict ist eine
Behauptung, keine Messung. Vor jeder Zahl, jeder Vollstaendigkeits-Aussage
("das ist alles", "keine weiteren") und JEDER Entscheidungsfrage an den User:
selbst messen (Grep/Glob/Bash/Read im selben Turn). Vor einer Entscheidungsfrage
zusaetzlich pruefen, ob es die Sache ueberhaupt gibt — existiert der Code-Pfad,
wie viele Aufrufer, welche Datei:Zeile. Bremsen B/C/D in
`scripts/hooks/answer-check.mjs` erzwingen das.

**Ergebnis- und Analyse-Antworten:** Befund zuerst. Danach nur, was der User
zum Weiterentscheiden braucht. Es gibt keine Zeilen-Vorgabe (User 2026-09-01:
zwei Zeilen sind okay, acht nach viel Arbeit auch) — der Massstab ist die
Sprache: **keine Fachbegriffe, die niemand versteht.** Jeden technischen
Ausdruck weglassen oder im selben Halbsatz erklaeren. Konsequenz zuerst, Technik
danach.

Verboten in Ergebnis- und Analyse-Antworten:
- Rekapitulation dessen, was gerade getan wurde („Ich habe X gelesen und dann Y")
- Status-Inventare („Datei A: fertig. Datei B: fertig. Datei C: fertig")
- Praeambeln („Gute Frage", „Lass mich das analysieren", „Hier ist die Antwort")
- Abschluss-Zusammenfassungen, die den Text davor wiederholen
- Ungefragte Naechste-Schritte-Menues
- Nacherzaehlen der Quelle statt Befund plus Beleg — „ausfuehrlich" heisst mehr
  Belege, nicht mehr Prosa
- Verbositaet in Tabellenform: EINE Tabelle mit hoechstens 8 Datenzeilen zaehlt
  nicht mit, jede weitere zaehlt komplett als Fliesstext

**Beleg-Pflicht:** Keine Zahl, kein Zustand, keine „das ist so"-Aussage ohne
Messung im selben Turn. Wenn nicht gemessen: „ungeprueft" dazuschreiben.

**Plan vor Code:** Nicht-triviale Aenderungen brauchen einen Plan in
`.claude/plan-current.md`, darin einen `## Verdicts`-Block mit den Verdicts der
Review-Agents und >=3 Alternativen, und eine Freigabe des Users. Das wird seit
2026-09-01 erzwungen: `scripts/hooks/write-gate.mjs` haengt als `PreToolUse` an
Edit/Write/MultiEdit/NotebookEdit/Bash/PowerShell und blockt auch schreibende
Shell-Kommandos (`sed -i`, Heredoc, `Set-Content`). Es hilft nicht, den Weg zu
wechseln — nur ein freigegebener Plan oeffnet es.

**Tool-Calls buendeln:** Unabhaengige Calls in EINE Message.
