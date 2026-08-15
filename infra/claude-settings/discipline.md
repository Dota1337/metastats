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

**Ergebnis-Antworten:** Befund zuerst, in maximal drei Zeilen. Danach nur, was
der User zum Weiterentscheiden braucht.

Verboten in Ergebnis-Antworten:
- Rekapitulation dessen, was gerade getan wurde („Ich habe X gelesen und dann Y")
- Status-Inventare („Datei A: fertig. Datei B: fertig. Datei C: fertig")
- Praeambeln („Gute Frage", „Lass mich das analysieren", „Hier ist die Antwort")
- Abschluss-Zusammenfassungen, die den Text davor wiederholen
- Ungefragte Naechste-Schritte-Menues

**Beleg-Pflicht:** Keine Zahl, kein Zustand, keine „das ist so"-Aussage ohne
Messung im selben Turn. Wenn nicht gemessen: „ungeprueft" dazuschreiben.

**Plan vor Code:** Nicht-triviale Aenderungen brauchen einen Plan in
`.claude/plan-current.md` und eine Freigabe des Users. Der PreToolUse-Gate
blockt Edit/Write ohne Freigabe — das ist kein Hinweis, sondern eine Sperre.

**Tool-Calls buendeln:** Unabhaengige Calls in EINE Message.
