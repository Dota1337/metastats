<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:metastats-multi-review-rules -->
# MUST: Multi-Agent-Review vor nicht-trivialen Code-Tasks

Wenn der User mit `Code:` einen nicht-trivialen Task anfragt (mehr als ein einzelner Typo / i18n-String / Konstanten-Wert / kommentierter Edit), MUSS ich VOR jeglicher Implementation:

1. **Mindestens 3 Alternativen mit explizitem Trade-off-Vergleich auflisten.** Tabelle oder nummerierte Liste mit ≥2 Trade-off-Spalten (Vorteil + Nachteil). Empfehlung kommt NACH dem Vergleich, basiert auf dokumentierten Trade-offs.

2. **Parallel 2-3 Custom-Sub-Agents spawnen via `Agent`-Tool** mit klarem Plan-Brief:
   - `metastats-data-skeptic` — bei Stats/Filter/Aggregation/DB-Datenlage/Sample-Size/Patch-Frische
   - `metastats-perf-critic` — bei API-Routes/Cache/DB-Queries/Snapshot-Pipeline/Cold-Start
   - `metastats-architect` — bei neuen Pattern/Storage-Wahl/mehrere synchron zu haltende Files/Rollback-Pfaden
   - `classification-reviewer` — bei Klassifikation/Tier-Listing/Whitelist/Filter-Buckets

   Auswahl: ≥2 davon die zum Task-Domain passen. Calls in EINER Message für parallele Ausführung.

3. **Verdicts dem User transparent zeigen** (eine Zeile pro Agent + zusammengefasste Empfehlung).

4. **Plan anpassen wenn Findings auftauchen**, dann erst implementieren.

Diese Regel überschreibt das Default-Verhalten „direkt implementieren". Das Auslassen ist NICHT eine Stilfrage — es ist eine Verletzung der Projekt-Architektur.

## Triviale Ausnahmen (Direct-Implement zulässig)

- i18n-String hinzufügen oder ändern
- Typo / Wording-Fix
- Konstanten-Wert ändern (z.B. Multiplier von X auf Y, wenn der User Y vorgibt)
- Bug-Fix in einer einzelnen Funktion ohne Pattern-Implikation
- User markiert explizit „Code: trivial" / „Code: spot-fix" / ähnlich

Bei Unsicherheit: Multi-Review starten, nicht überspringen. Eine zu Unrecht durchgeführte Review kostet 60-120s; ein zu Unrecht ausgelassener Review-Schritt kostet Nacharbeit-Schleifen.

## Memory-Referenzen
- `feedback_pre_implementation_multi_review.md` — voller Workflow
- `feedback_alternatives_with_tradeoffs.md` — 3-Alternativen-Pflicht
- `infra/claude-agents/*.md` — Agent-Definitionen
<!-- END:metastats-multi-review-rules -->
