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
   - `metastats-logic-flow-critic` — bei systemd-Service-Files/OnSuccess/Conflicts/Watchdog/Cursor/State-Machines/Multi-Driver-Cascade
   - `classification-reviewer` — bei Klassifikation/Tier-Listing/Whitelist/Filter-Buckets

   Auswahl: ≥2 davon die zum Task-Domain passen. Calls in EINER Message für parallele Ausführung.

   **Auch ohne `Code:`-Prefix Pflicht:** wenn der User-Befehl semantisch eine Implementierungs-Aufgabe ist ("deploy X", "setze um", "mach weiter"), gilt die Multi-Review-Pflicht weiterhin. Der UserPromptSubmit-Hook fängt nur explizite `Code:`-Tasks ab — bei impliziten Implementierungs-Aufträgen muss ich SELBST die Multi-Review fahren.

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

<!-- BEGIN:metastats-spec-first-rules -->
# MUST: Spec-First-Plan vor nicht-trivialen `Code:`-Tasks (Default: user-approved blocking)

Vor jedem nicht-trivialen `Code:`-Task läuft der Spec-First-Workflow VOR der Multi-Review-Phase:

```
Spec-Architect spawnen  →  WARTE AUF FREIGABE  →  Multi-Review  →  Implementation
```

## Schritt 1: Trivial-Whitelist mechanisch prüfen

Spec ist nur dann übersprungen wenn EINE Bedingung mechanisch erfüllt ist (KEIN LLM-Judgement):
- Prompt enthält explizit `Code: trivial` / `Code: spot-fix`
- Diff betrifft NUR `app/lib/i18n.tsx` (i18n-Strings)
- Konstanten-Wert-Change in einer einzelnen Zeile
- Bug-Fix in einer einzelnen Funktion ohne Pattern-Implikation
- Typo-Fix

Bei Unsicherheit: Spec fahren.

## Schritt 2: metastats-spec-architect-Subagent spawnen

Via `Agent`-Tool mit `subagent_type: metastats-spec-architect`. Brief: aktueller User-Prompt + relevante Memory-Anker.

Output enthält strukturiert:
- User-Beispiele-Walkthrough
- Implizite Annahmen explizit
- Edge-Cases & Konsolidierungs-Entscheidungen
- Memory-Konflikt-Sektion (inline Self-Critique gegen relevante `feedback_*`-Memories)
- Akzeptanzkriterien
- Aufwand-Schätzung (realistisch, vergleiche `feedback_realistic_effort_estimates.md`)
- Soft-Gate-Marker „WARTE AUF FREIGABE"

## Schritt 3: Soft-Gate (User-Approval)

Spec-Output endet mit „WARTE AUF FREIGABE". Ich warte auf User-Reply:
- `passt` / `ok` / `go` / `freigabe` / `los` → weiter zu Multi-Review (Schritt 4)
- Adjustments im Prompt → Spec-Run mit Adjustments als Input
- `autonom` → Autonom-Modus AN, Auto-Approval für folgende Tasks bis `manuelle freigabe`
- Neuer `Code:`-Topic → alter Spec-State verfällt LOUD (nicht silent)

## Schritt 4: Multi-Review-Phase (wie bisher)

NACH Approval: bestehender Multi-Review-Workflow aus oben (data-skeptic/perf-critic/architect/etc.).

## Schritt 5: Implementation + Commit

NACH Multi-Review-Verdicts: Code-Edit, tsc, commit, push.

## Anti-Sabotage

Trivial-Whitelist ist mechanisch, NICHT LLM-Judgement. Wenn ich versucht bin Spec zu überspringen mit „diese Task ist trivial":
1. Whitelist mechanisch prüfen
2. KEINE Bedingung erfüllt → Spec ist Pflicht
3. Bei Subjektiv-Versuchung: lieber Spec fahren (60s Aufwand vs Nacharbeit-Schleifen)

`feedback_disable_gateguard.md` zeigt: harte Hooks die nerven werden deaktiviert. Spec ist SOFT-Gate (Convention im Output, kein settings.json-Hook) und damit robuster gegen Selbst-Sabotage.

## Memory-Referenzen
- `feedback_spec_first_discipline.md` — voller Workflow + Trivial-Whitelist
- `reference_tft_aggregation_hierarchy.md` — Aggregations-Konventionen (Pflicht-Check bei Aggregations-Tasks)
- `reference_tft_match_v1_schema.md` — Match-V1 vs Cache-Schema
- `reference_tft_set17_knowledge_index.md` — Set-17-Fakten-Pointer
- `infra/claude-agents/metastats-spec-architect.md` — Spec-Architect Agent-Definition
<!-- END:metastats-spec-first-rules -->
