# Spec-V2: Stats-Aggregator-Architektur (Read-Write-Entkopplung)

**Stand:** 2026-06-25
**Vorgaenger:** Spec-V1 (Chat-Only, 2026-06-25 vormittag) — FAIL durch data-skeptic + 3x NEEDS-ATTENTION von Multi-Review
**User-Vorgabe:** "qualitativ beste Loesung langfristig" — kein Quick-Win-Bias
**Topic-Domain:** infra
**Zustand:** Spec, awaiting WARTE-AUF-FREIGABE
---

## 0. Vector-Search Memory-Anker (Schritt 0)

**Query:** "Stats-Aggregator Architektur Read-Write-Entkopplung Publisher Manifest Coexistenz Cursor Race-Condition systemd OnSuccess Cascade Patch-Resolver Bucket-Fix Coverage Dual-Writer" + 3 Folge-Queries

**Top-K Treffer (relevanteste 12, sortiert nach Spec-Bezug):**

| # | file_path | section / Fundstelle | dist | topic | Stale? | Was die Memory in 1 Zeile sagt |
|---|---|---|---|---|---|---|
| 1 | reference_snapshot_first_pattern.md | Snapshot-Cushion bei DB-Down | 0.71 | tft | 2d — frisch | Listing-Welle PFLICHT, Detail Optional-Boost; Snapshot = Verfuegbarkeits-Cushion |
| 2 | reference_supabase_outage_runbook.md | gesamtes File | 0.81 | tft | 2d — frisch | 5-Schritt-Runbook + Eskalations-Trigger 3 in 14d / 2 in 48h scharf |
| 3 | reference_crawler_architecture.md | OnSuccess-Kette + Resilience-Gaps | 0.70 | infra | 4d — frisch | OnSuccess-Topologie, 3 ungeloeste Daily-Crawl-Resilience-Gaps, Sub-Region-Resume-Pattern (Inflight-Tabelle) |
| 4 | reference_marketvalue_daily_pipeline.md | gesamtes File + Region-Cursor | 0.70 | infra | 4d — frisch | Cursor-Pattern, Region-Sub-Resume, Backup-Pattern, systemd-Unit-Layout |
| 5 | project_status_2026_06_21_supabase_patch_rpc.md | gesamtes File + Mitigations | 0.64 | tft | 2d — frisch | RPC-Fix 25s→140ms via crawl_meta, Manifest-Fallback-Cascade, Multi-Review-Verdicts vom 06-21 |
| 6 | reference_tft_comp_detail_snapshot.md | Snapshot-Lifecycle + Rollback-Pfad | 0.70 | tft | 2d — frisch | Family-Snapshot ~720 Permutationen, Manifest-Update am Publisher-Ende, Rollback-Guard |
| 7 | reference_tft_pipeline_ops.md | Comps-Lean-RPC + 6h-Cache + Cache-Warming | 0.69 | tft | 4d — frisch | List vs Detail RPC-Split, STATS_CACHE_CONTROL s-maxage=21600+swr=86400, 5min→6h Patch-Cache, Bucket-Gruppen-Falle |
| 8 | reference_hetzner_supabase_db_split.md | Konsequenz fuer Crawler-Erweiterungen | 0.80 | tft | 4d — frisch | Hetzner-Local-PG hat KEINE tft_daily_*, Driver muss via REST gehen |
| 9 | feedback_realistic_effort_estimates.md | gesamtes File | n/a | workflow | 5d — frisch | Schaetze zur Mediane statt P95, Wartezeit != Aufwand |
| 10 | feedback_alternatives_with_tradeoffs.md | gesamtes File | n/a | workflow | 9d — frisch | >=3 Optionen Pflicht, Empfehlung NACH Trade-off-Vergleich |
| 11 | feedback_pre_implementation_multi_review.md | gesamtes File | 0.82 | workflow | 4d — frisch | 2-3 Custom-Agents PARALLEL spawnen vor Implementation |
| 12 | feedback_verify_background_services.md | gesamtes File | 0.68 | tft | 4d — frisch | "laeuft + active" != "schreibt erfolgreich" — Service-Status + Cursor + DB-Writerate verifizieren |

**Stale-Markierungen:** Memories 1, 2, 5, 6 sind 2 Tage alt — System-Reminder beim Read sagte "point-in-time observations, verify against current code before asserting as fact". Konkret zu verifizieren VOR Phase-2-Trigger:
- Manifest-Inhalt heute (post Bucket-Fix + Publisher-Re-Run): hat comps/*-Listings-Entries oder nur comps-detail/*?
- 6h Patch-Cache TTL aktuell? Spec-V1-perf-critic fand 5min im Code vs 60s in V1-Spec — beide widersprechen reference_tft_pipeline_ops.md ("5min → 6h"). **Drift-Check Pflicht-Probe vor Phase-2-Start.**
- OnSuccess-Kette in infra/hetzner/metastats-daily-crawl.service IST-Stand (3 OnSuccess-Targets laut Memory, aber Spec-V1-logic-flow fand systemd-Semantik PARALLEL nicht sequenziell)

---

## 1. User-Beispiele (aus heutiger Probe)

Was der User HEUTE konkret gemessen + reported hat:

**DB ist NICHT der Bottleneck:**
- diamond_plus / 7d / all-regions: 50ms warm, 112ms cold (EXPLAIN ANALYZE)
- 16410 rows / 1097 cluster_keys / 719k games — substantiell, nicht "leer"

**Bucket-Bug Wurzel war Mismatch (jetzt behoben in Commit 2918d8e):**
- bucket=diamond_plus existiert NICHT in DB — RPCs matchen bucket = ANY(...) mit echten Werten (master/grandmaster/challenger), Gruppe muss VOR Call expandiert werden
- Memory reference_tft_pipeline_ops.md "Bucket-Gruppen-Falle" warnt explizit — V1-Spec hatte das uebersehen, V2 muss es als BLOCKER-Anchor erkennen

**Patch-Resolver-Boundary konkret:**
- 17.5 dominant (852k games / 5 days), 17.6 neu seit 2 Tagen (52k games)
- PATCH_MIN_GAMES=100_000 filtert 17.6 → resolved current=17.5
- Bei Drift zwischen Resolver-Stellen wuerden inkonsistente Patches in verschiedenen Routes auftauchen → User sieht "Daten lueckenhaft"

**Pipeline-Frische ist by-design:**
- alle 15 Regionen latest_day = today-2 — vollstaendige UTC-Tage aggregiert
- pro_pool nur 4 Regionen (kr/euw1/na1/jp1), 11 Regionen 0 pro_pool — legitim leer, NICHT als Bug behandeln

**Edge-Cache funktioniert:**
- Default-Filter → HIT nach erstem MISS
- Aggregator-Wert liegt primaer in Tail-Coverage + Outage-Resilience, NICHT in Default-Pfad-Speed

**Operations-Constraints:**
- Hetzner-Volume 86% used (48G/59G) nach Backup-Cleanup heute — Storage-Budget fuer Aggregator-Output ist eng
- Publisher-Re-Run laeuft aktuell im Hintergrund — Phase-1-Beobachtung muss dessen Resultat abwarten

---

## 2. Annahmen die ich treffe (explizit zur Anfechtung)

1. **DB-Bottleneck-These ist tot.** 50ms warm + 112ms cold sind weit unter 2s Live-RPC-Timeout. Aggregator loest KEIN Performance-Problem fuer Hot-Pfade. Sein Wert liegt ausschliesslich in (a) Tail-Coverage gegen Cold-Function-Spikes, (b) Outage-Resilience bei DB-522, (c) reduzierter Compute-Last (weniger RPC-Calls = weniger Saturation-Risiko).

2. **"Aggregator ersetzt Publisher" ist FALSCH.** Beide schreiben in Vercel-Blob. Publisher generiert aus Live-RPC-Hits, Aggregator aus Per-Region-Day-Mini-Aggregat. Dual-Writer-Phase ist die kritische Coexistenz-Periode — beide schreiben in DASSELBE Manifest mit Merge-Strategy, NICHT mit Cut-over.

3. **Edge-Cache ist primaerer Hot-Path-Layer.** Aggregator fuellt nur Cold-Path-Misses. Wenn Edge-Cache >85% Hit-Rate bei Default-Filter hat, ist der ROI eines Aggregators fuer Default-Filter quasi null — er zahlt sich nur in Tail aus.

4. **Phase-1-Beobachtung kann Aggregator obsolet machen.** Wenn der heute deployed Bucket-Fix + Publisher-Re-Run-Wirkung eine Manifest-Coverage >95% real-existing-Permutationen erzeugen UND keine neuen DB-Outages in 7 Tagen kommen, ist Option C (strukturelle Haertung) der ehrlichere Endzustand. Aggregator-Welle nur wenn empirisch noetig.

5. **"7 Tage Coexistenz" ist NICHT willkuerlich.** Bei Set-17→18-Bump spaeter muss Rollback in <24h moeglich sein. 7 Tage Dual-Write-Periode ist (a) genug um Publisher-Re-Run-Welle zu beobachten und (b) gibt Cushion fuer eine Wochenend-Diagnose wenn etwas driftet.

6. **PATCH_MIN_GAMES=100_000 ist HARD-CONSTRAINT.** Jeder Resolver-Pfad (Inline-SQL, RPC, Lib-Function, Manifest-Build) muss DENSELBEN Filter haben. Drift erzeugt unverbundene Patches in Routes → User sieht teilweise 17.5, teilweise 17.6 → Daten wirken inkonsistent.

7. **Cursor-inflight-Semantik aus Marktwert-Pattern ist uebertragbar** (siehe reference_crawler_architecture.md Sub-Region-Resume). Per-region-day-bucket-Cursor in einer Hetzner-Local-PG-Tabelle tft_aggregator_inflight mit state IN (pending, inflight, done, failed) + Determinismus-Pflicht (puuid-Sort vor jedem Aggregate).

8. **Hetzner-Local-PG hat KEINE tft_daily_* Tabellen** (reference_hetzner_supabase_db_split.md). Aggregator-Driver muss Aggregat-Schreibziel via Supabase-REST/Pool ansprechen — NICHT lokaler pg.Pool. Cursor-Tabelle aber lokal (analog Marktwert-Inflight).

---

## 3. Edge-Cases

| # | Case | Behandlung |
|---|---|---|
| E1 | Daily-Crawl heute fehlgeschlagen → Aggregator startet ohne Source-Daten | Aggregator MUSS tft_daily_crawl_meta als Source-Trigger lesen — wenn 0 Regionen heute komplett, exit 75 (skip), kein leeres Manifest schreiben |
| E2 | Patch-Boundary mitten in 7d-Window (heute 17.5/17.6) | Resolver liefert current=17.5, Aggregator schreibt sowohl patch=current (17.5-only) als auch patch=all (7d ueber beide). UI-Filter zeigt entsprechend |
| E3 | bucket=diamond_plus Anfrage (post-Bucket-Fix) | Manifest-Key muss BUCKET_GROUPS-expandiert sein — diamond_plus → [diamond,master,grandmaster,challenger]-Hash als Stamp; Aggregator schreibt gegen die Gruppe NICHT gegen bucket=diamond_plus literal |
| E4 | Sonntag-Race: prune-Cron 04:00 UTC + Aggregator-Sonntag-Welle | prune verschieben auf Sonntag 23:00 UTC (V1-Finding architect F6 + logic-flow F5); Aggregator-Run-Trigger ist OnSuccess von Daily-Crawl (~14:00 UTC Sonntag) → genug Abstand |
| E5 | Single-Permutation hat <100 games | Aggregator schreibt mit coverage.expected_non_empty=false-Flag; UI zeigt nicht "Noch keine Daten" sondern "zu wenig Sample" |
| E6 | SIGTERM mid-Endpoint (logic-flow F7) | Per-Endpoint-Cursor-Persistenz: vor jedem Endpoint-Write Cursor-Update state=inflight + after-Write state=done. Resume liest Cursor + skipt bis erstes non-done |
| E7 | Manifest-Write race zwischen Publisher und Aggregator (V1 BLOCKER #1) | Single-Write-Lock via Hetzner-Local-PG pg_advisory_lock(MANIFEST_LOCK_KEY); beide Schreiber merge-and-write atomisch in einer Transaction-Equiv-Sequence |
| E8 | Set-17→18-Bump mitten in Coexistenz | Aggregator + Publisher muessen set_number-aware sein; bei current_set != last_aggregator_set Cursor full reset + Manifest-Section fuer altes Set in legacy/ verschieben (KEIN delete) |
| E9 | 14h Daily-Crawl-Laufzeit + Watchdog-Trigger 18:00 UTC | Aggregator-Trigger NICHT vom Watchdog (Watchdog ist Recovery-Reflex, nicht Schedule). Aggregator startet via OnSuccess von Daily-Crawl ODER manuell |
| E10 | Hetzner-Volume voll waehrend Aggregator-Run | ExecStartPre Disk-Check (df --output=pcent /mnt/HC_Volume_105869432 awk-Check >=90 exit 1) → exit 75 wenn voll, alert via journal |
| E11 | RUN_DAY-Drift bei Mid-Night-Crossing (V1 logic-flow) | RUN_DAY=date -u +%Y-%m-%d am Driver-Top gepinnt, KEIN re-eval mid-run |
| E12 | Manifest-Cache Process-TTL vs Edge-TTL Drift | Single-Source: Process-Memory-Cache + Edge-Cache haben unterschiedliche TTL by design; aber Manifest-Header Cache-Control darf NICHT widersprechen — Code-Drift-Check via Test-Snapshot |

---

## 4. Konsolidierungs-Entscheidungen

Nicht direkt eine Family-/Cluster-Aggregation, aber 4 konsolidierungs-aehnliche Entscheidungen:

| Entscheidung | V1-Stand | V2-Entscheidung | Memory-Begruendung |
|---|---|---|---|
| Coexistenz-Modell | phased-Cut-over via env-Flag | **7-Tage Dual-Writer mit Merge-Strategy** | architect F1+F2 V1-Verdict + reference_tft_comp_detail_snapshot.md Rollback-Pfad-Pattern |
| Cursor-Tabelle Location | Supabase | **Hetzner-Local-PG** (analog Marktwert-Inflight) | reference_hetzner_supabase_db_split.md + Determinismus-Lessons aus Marktwert |
| Patch-Resolver-SoT | inline-SQL + RPC parallel | **Ein RPC get_tft_resolved_patch(p_set, p_min_games) Single-Call**, alle anderen Stellen wrappen | data-skeptic F2 + F9 V1-Verdict |
| isDefaultPermutation-Location | lookup.ts | **snapshot-matrix.ts SoT**, lookup.ts importiert | architect F4 V1-Verdict |

---

## 5. Memory-Konflikte / Verify-Punkte

| # | Memory-Anker | Geplante V2-Loesung | Konsistent? | Aktion |
|---|---|---|---|---|
| 1 | reference_snapshot_first_pattern.md "Listing-Welle PFLICHT" | V2 schreibt Listing UND Detail-Welle in Aggregator | JA | — |
| 2 | reference_supabase_outage_runbook.md Eskalation 3-in-14d scharf | Heute 3-in-20d, V2 reduziert Compute-Last via Aggregator weiter | JA | — |
| 3 | reference_crawler_architecture.md OnSuccess-Kette PARALLEL (V1 logic-flow F1) | V2 macht Aggregator NICHT als OnSuccess sondern als catchup-Script-Entscheidung | KONSISTENT (PARALLEL-Semantik akzeptiert) | Probe vor Phase 2: aktuelle OnSuccess-Reihenfolge in Unit-File real verifizieren |
| 4 | reference_marketvalue_daily_pipeline.md Cursor-JSON-File | V2 nutzt PG-Table statt JSON (Mengen-staerker bei vielen Endpoints) | UMSCHALTUNG | Begruendung: 4 Endpoints x 15 Regionen x 7d = 420 Cursor-Rows, JSON wird unhandlich. PG-Table mit (region,day,endpoint,set_number) PK |
| 5 | project_status_2026_06_21_supabase_patch_rpc.md Manifest-Fallback Cascade | V2 erhaelt Manifest-Fallback in Publisher als Defense, ergaenzt Aggregator als Source | JA | Publisher bleibt PRIMAER fuer Hot-Path (V1 architect F7: Phase 11 static statt masked) |
| 6 | reference_tft_comp_detail_snapshot.md Snapshot-Lifecycle | V2 erbt snapshotKey enthaelt resolvedPatch Auto-Inval-Pattern | JA | — |
| 7 | reference_tft_pipeline_ops.md Bucket-Gruppen-Falle | V2-BLOCKER #3: Bucket-Fix fuer alle 4 RPCs (heute done fuer 1 RPC) | JA, aber Pflicht zu verifizieren | Probe vor Phase 2: get_tft_unit_stats, get_tft_item_stats, get_tft_trait_stats, get_tft_comp_stats ALLE Bucket-Expansion korrekt |
| 8 | feedback_verify_background_services.md "laeuft != schreibt erfolgreich" | V2 Phase 1 hat explizit Schreibrate-Probe als Akzeptanz | JA | — |
| 9 | feedback_realistic_effort_estimates.md schaetze zur Mediane | V2 schaetzt Option A bewusst konservativer (10-14d) weil V1 unter Multi-Review reentrant Race-Conditions findet | KONSISTENT mit "realistisch" — die echten 10-14d sind nicht Buffer sondern echte Edges | — |
| 10 | feedback_alternatives_with_tradeoffs.md >=3 Optionen Pflicht | Spec hat A/B/C unten | JA | — |
| 11 | feedback_pre_implementation_multi_review.md 2-3 Custom-Agents | Nach Approval → architect + logic-flow-critic + perf-critic + data-skeptic (4x) parallel | JA | — |

---

## 6. Strategische Reihenfolge — DREI Phasen

```
[Phase 0 DONE]  Bucket-Fix Commit 2918d8e  =>  Disk-Recovery  =>  Backup-Script-Versioning
                v
[Phase 1]       7 Tage BEOBACHTUNG -- kein Code, nur Metriken sammeln
                v
                Trigger-Check fuer Phase 2 (siehe Akzeptanz-Schwellen)
                v
[Phase 2]       Strategie-Wahl A / B / C  =>  Multi-Review-Phase  =>  Implementation
                v
[Phase 3]       7-Tage-Coexistenz Dual-Writer  =>  Cut-over  =>  Publisher zu static/legacy
```

---

## 7. Phase-1-Beobachtungs-Plan (Pflicht VOR Phase 2)

**Dauer:** 7 Tage (2026-06-25 bis 2026-07-02)
**Aufwand:** ~30 Min/Tag Metriken-Check, ~2h Setup eines One-Pager-Dashboards

### Probe-Set (was wir taeglich messen)

| Metrik | Quelle | Schwelle fuer Phase 2 Option A | Schwelle fuer Phase 2 Option B | Schwelle fuer Phase 2 Option C |
|---|---|---|---|---|
| Manifest-Coverage real-existing-Permutationen | scripts/probe-manifest-coverage.mjs (neu) | <85% nach 3d | 85-95% | >=95% |
| Edge-Cache-Hit-Rate Default-Filter | Vercel-Analytics + Custom-Probe | <70% | 70-85% | >=85% |
| Cold-RPC-p99 Tail-Permutationen | Vercel-Function-Logs grep | >2.5s | 1.5-2.5s | <=1.5s |
| Function-Timeouts (HTTP 502) in 7d | Vercel-Logs | >=3 in 7d | 1-2 in 7d | 0 in 7d |
| Neue Supabase-Outage (HTTP 522) | reference_supabase_outage_runbook.md Detect-Curl | >=1 in 7d | (irrelevant) | 0 in 7d |
| Bucket-Fix-Drift in anderen RPCs | manuelle Probe get_tft_unit_stats etc. | >=1 RPC noch broken | 0 broken | 0 broken |

**Decision-Tree nach Tag 7:**
- Wenn ALLE Tail-Metriken Option-C-Schwelle erreichen → Option C (1-2d struktureller Haertung) reicht
- Wenn Manifest-Coverage 85-95% UND keine neuen Outages → Option B (3-5d Minimal-Aggregator nur nicht-cushioned)
- Wenn neuer Outage ODER Coverage <85% nach 3d → Option A (10-14d Full-Aggregator)

**One-Pager-Dashboard (Setup-Aufwand ~2h):**
- Script scripts/probe-aggregator-readiness.mjs laeuft daily via cron, schreibt JSON nach /internal/3d-ops (existiert schon, reference_internal_ops_dashboard.md)
- Ein neuer Tab "Phase-1-Beobachtung" in /internal/3d-ops mit 6 Metriken-Cards + Tagesverlauf

---

## 8. DREI Strategie-Alternativen fuer Phase 2

### Option A — Full-Aggregator wie V1 (10-14 Tage)

**Scope:** Eigener metastats-stats-aggregator.service, schreibt 4 Endpoints (comps/units/items/traits) x 15 Regionen x Buckets x Patches x Days-Windows = ~720 Permutationen taeglich. Erzeugt Manifest-Section aggregator/*. Publisher bleibt parallel fuer 7d Coexistenz, dann auf static-Modus.

| Aspekt | Detail |
|---|---|
| **Vorteil** | (1) Volle Tail-Coverage, jeder Filter hat Snapshot. (2) Outage-Cushion 100%. (3) Compute-Last auf Supabase faellt um ~60% (Aggregat-Reads statt Live-RPCs) |
| **Nachteil** | (1) 10-14d Implementation echt -- V1 fand 15 konvergente Findings mit echter Komplexitaet. (2) Storage-Last auf Hetzner-Volume (86% used heute) -- Aggregator-Output ~200 MB. (3) Cursor + Race-Conditions echt, jede Phase-2-Iteration findet eine neue Edge. (4) Set-Bump-Migration komplex (2 Files synchron) |
| **Aufwand realistisch** | **10-14 Tage** (V1-Findings adressieren) -- kein Buffer, das ist median |
| **Wann gerechtfertigt** | Phase-1 zeigt: >=1 neuer Outage, Coverage <85%, Function-Timeouts >=3 |

**Pflicht-Anforderungen (alle 15 V1-Findings adressiert):**

A1. **7-Tage Coexistenz mit Dual-Writer-Merge-Strategy** (V1 BLOCKER #1)
   - Publisher schreibt in manifest.publisher.*, Aggregator in manifest.aggregator.*
   - Reader-Logik: aggregator.* ?? publisher.* (Aggregator als Hot-Source, Publisher als Defense)
   - Single-Write-Lock via Hetzner-Local-PG pg_advisory_lock

A2. **OnSuccess-Cascade Parallel-Aware** (V1 BLOCKER #2)
   - Daily-Crawl OnSuccess triggert metastats-daily-crawl-catchup.service der seriell entscheidet: snapshot-publisher -> stats-aggregator -> marketvalue-snapshot
   - ExecStartPre=is-active daily-crawl.service exit 75 wenn parent laeuft
   - Catchup-Script logged Sequenz-Entscheidung in journal

A3. **Bucket-Fix fuer ALLE 4 RPCs verifiziert** (V1 BLOCKER #3, post heute)
   - Pflicht-Probe in Phase 1: comps + units + items + traits alle mit bucket=diamond_plus -> HTTP 200 + non-zero rows
   - Wenn IRGENDEINE noch broken -> Phase 2 Option A startet NICHT

A4. **Cursor-inflight-Resume-Semantik explizit** (V1 BLOCKER #4)
   - Hetzner-Local-PG-Tabelle tft_aggregator_inflight(region,day,endpoint,set_number,state,started_at,completed_at) PK(region,day,endpoint,set_number)
   - State-Machine: pending -> inflight -> done|failed
   - Driver liest beim Start WHERE day=RUN_DAY AND set_number=CURRENT_SET AND state IN (pending,inflight) als Work-Queue
   - Stale-Cleanup WHERE day < today - 7 beim Driver-Start

A5. **Patch-Resolver-SoT als Single-RPC** (HIGH #5)
   - Neue RPC get_tft_resolved_patch(p_set int, p_min_games int DEFAULT 100000) -- returnt (current_patch, previous_patch, available_patches jsonb)
   - jsonb_agg(patch ORDER BY first_seen DESC) fuer Determinismus (data-skeptic F9)
   - Alle Caller (Aggregator, Publisher, Live-RPC, Manifest-Build) gehen ueber diese eine Funktion
   - PATCH_MIN_GAMES=100_000 als RPC-Default-Parameter, nirgendwo sonst hardcoded

A6. **isDefaultPermutation SoT in snapshot-matrix.ts** (HIGH #6)
   - Move aus lookup.ts, lookup.ts importiert
   - Unit-Test npm run test:snapshot-matrix (neu) verifiziert Lookup-vs-Matrix-Konsistenz

A7. **SET statement_timeout = 90s** auf jeder Pool-Connection (HIGH #7)
   - In scripts/lib/stats-aggregator-pool.mjs (neu) on connection-init
   - Watchdog-Skip-Check matcht deactivating|reloading (V1 logic-flow F3)

A8. **Pool-Serialisierung mit daily-marketvalue-snapshot via After=** (HIGH #8)
   - Unit-File metastats-stats-aggregator.service hat After=metastats-marketvalue-snapshot.service
   - Verhindert parallele Riot-Key-Contention (existiert bei Marktwert auch)

A9. **endpointVersion ODER hasRequiredFields() -- eine Strategie waehlen** (HIGH #9)
   - V2-Wahl: endpointVersion als Integer in Manifest-Section, bump bei Schema-Change -> erzwingt Regenerate
   - hasRequiredFields() wird OBSOLETE, ist nur Defense bei alten Snapshots im legacy/-Bereich

A10. **9 Logic-Flow-Race-Conditions** (HIGH #10) -- alle einzeln adressiert:
   - a) RUN_DAY=date -u +%Y-%m-%d am Driver-Top gepinnt
   - b) ExecStartPre=is-active daily-crawl exit 75 wenn laeuft
   - c) Watchdog-Skip-Check matcht deactivating|reloading zusaetzlich zu active|activating
   - d) bidirektionales Conflicts= mit fullsync: V2 macht Conflicts= UNIDIREKTIONAL (daily-crawl conflicts gegen aggregator, NICHT umgekehrt) + Wochenend-fullsync laeuft nur Sonntag 23:00 nach prune
   - e) Manueller Start waehrend Daily-Crawl: ExecStartPre blockt mit exit 75 (siehe b)
   - f) Snapshot-Race prune-Cron Sonntag 04:00 -> **Sonntag 23:00 UTC** verschieben (MITTEL #13)
   - g) SIGTERM mid-Endpoint: per-Endpoint Cursor-Update + Resume-Skip
   - h) ON CONFLICT fuer Manifest-Write Atomicity: Hetzner-Local-PG-Cursor + pg_advisory_lock fuer Manifest-Section-Update
   - i) 5 Trigger-Wege Race-Convergence: alle gehen ueber catchup-Script (A2)

A11. **Coverage-Akzeptanz expected non-empty vs expected** (HIGH #11)
   - coverage.json in Manifest mit {expected_total, expected_non_empty, actual_non_empty, actual_total}
   - Akzeptanz: actual_non_empty / expected_non_empty >= 99% UND actual_total / expected_total >= 95%

A12. **prune-Cron Sonntag 04:00 -> Sonntag 23:00 UTC** (MITTEL #13) -- siehe A10f

A13. **Publisher Phase 11 auf static, NICHT masked** (MITTEL #14)
   - Erhaelt Rollback-Pfad: bei Aggregator-Bug kann Publisher reaktiviert werden via Env-Toggle ohne systemctl-unmask

A14. **remote-deploy.sh crawl_running() listet Aggregator** (MITTEL #15)
   - Damit Deploy nicht mid-Aggregator-Run kommt

A15. **Manifest-Cache-TTL Drift adressieren** (Spec-Drift V1)
   - V2-Wahl: 5min Process-Cache (heute) BLEIBT (matcht Manifest-Update-Frequenz Aggregator-Run), Doku in reference_snapshot_first_pattern.md updaten

---

### Option B — Minimal-Aggregator nur nicht-cushioned Permutationen (3-5 Tage)

**Scope:** Aggregator schreibt NUR Permutationen die Publisher heute NICHT hat (Listing-Cushion-Gap), KEINE Detail-Welle (die ist publisher-resourced). ~24 Permutationen statt 720. Reaktion auf konkretes Coverage-Gap aus Phase-1-Beobachtung.

| Aspekt | Detail |
|---|---|
| **Vorteil** | (1) Klein, fokussiert auf bewiesenes Gap. (2) Risiko-Profil viel kleiner -- kein 7d Dual-Writer, einfach Manifest-Append fuer die fehlenden Keys. (3) Setzt auf existierenden Publisher auf statt parallel |
| **Nachteil** | (1) Loest Tail-Coverage NICHT (nur Listing). (2) Bei breitem Outage immer noch Detail-Pages tot ohne Publisher. (3) Wenn neue Permutationen kommen muss man re-evaluieren |
| **Aufwand realistisch** | **3-5 Tage** -- kleiner Driver, KEINE neue Cursor-Tabelle (JSON-File OK), KEINE OnSuccess-Cascade-Changes, KEIN Patch-Resolver-Refactor |
| **Wann gerechtfertigt** | Phase-1 zeigt: keine neuen Outages, Coverage 85-95%, Function-Timeouts 1-2 (irritierend aber nicht broken) |

**Pflicht-Anforderungen:**

B1. Cursor in /etc/metastats-crawler/aggregator-cursor.json (JSON, analog Marktwert-Region-Cursor) -- keine PG-Table

B2. Driver scripts/aggregator-listing-fill.mjs laeuft als OnSuccess von Daily-Crawl, schreibt NUR listing/*-Keys ins Manifest

B3. Manifest-Append-Strategy: liest existing Manifest, merged neue Keys, schreibt zurueck mit pg_advisory_lock

B4. Bucket-Fix fuer comps-RPC (heute done) als Pflicht -- andere RPCs erst wenn Probe-Schwelle erreicht

B5. KEIN endpointVersion -- Option B ist Defense-Only, kein Schema-Change

B6. ExecStartPre=is-active daily-crawl + After=marketvalue-snapshot analog A8

B7. Phase-1-Beobachtungs-Dashboard wird zur Phase-2-Watch-Source

---

### Option C — Strukturelle Haertung existing Publisher (1-2 Tage)

**Scope:** KEIN neuer Service, KEIN Aggregator. Haertung des existing scripts/publish-snapshot-bundle.mjs mit Try/Catch + Snapshot-Guard + Manifest-Append-Strategy + Listing-Welle-Pflicht-Bit.

| Aspekt | Detail |
|---|---|
| **Vorteil** | (1) Schnell, ehrlich zur Probe (Phase-1 zeigt System ist OK). (2) Kein neuer Service = keine neue Race-Surface. (3) Kein 7d-Coexistenz-Risiko. (4) Storage-Budget bleibt erhalten |
| **Nachteil** | (1) Bei Compute-Saturation waehrend Publisher-Run kein Outage-Cushion verbessert. (2) Tail-Coverage bleibt publisher-resourced (~720 Permutationen Decision via snapshot-matrix.ts). (3) Wenn spaeter doch ein Aggregator gebraucht wird, muss man dann erst doch implementieren |
| **Aufwand realistisch** | **1-2 Tage** -- Edit publish-snapshot-bundle.mjs + Listing-Welle-Test + Smoke-Probe |
| **Wann gerechtfertigt** | Phase-1 zeigt: 0 neue Outages, Coverage >=95%, Function-Timeouts 0, Cold-RPC-p99 <=1.5s |

**Pflicht-Anforderungen:**

C1. **Try/Catch um jede Permutation** -- eine fehlgeschlagene Permutation killt nicht den ganzen Publisher-Run

C2. **Snapshot-Guard hit && payload.hasData && payload.comp != null** wie reference_tft_comp_detail_snapshot.md Rollback-Pfad -- fuer alle Endpoints einheitlich

C3. **Manifest-Append-Strategy** -- Publisher kann inkrementell laufen ohne komplettes Re-Generate

C4. **Listing-Welle-Pflicht-Bit** -- scripts/publish-snapshot-bundle.mjs hat ein Flag --listing-only das die ~24 Listing-Permutationen schreibt (analog reference_snapshot_first_pattern.md Listing-Welle PFLICHT)

C5. **Patch-Resolver-SoT trotzdem** -- auch hier sinnvoll, eines der V1-HIGH-Findings, kostet 2-3h zusaetzlich

C6. **Coverage-Pflicht-Bit** in Manifest mit expected_total + actual_total fuer Beobachtung post-Haertung

C7. **NEUER prune-Schedule Sonntag 23:00** (analog A12) -- faengt das Sonntag-Race ein

---

## 9. Empfehlung (NACH Trade-off-Vergleich)

**Phase-2-Strategie ist DATENABHAENGIG -- Entscheidung nach Phase-1-Beobachtung in 7 Tagen.**

Aktueller Stand (post Bucket-Fix Commit 2918d8e + Publisher-Re-Run heute):
- 3 Timeout-Permutationen funktional -> Coverage-Probe heute Abend wird zeigen ob >=95%
- Edge-Cache funktioniert -> Hot-Path ist gesund
- Keine neue Outage seit 2026-06-23 (heute Tag 2)

**Mein Bias:** Option C ist der wahrscheinliche Endzustand. V1-Spec war Aggregator-getrieben weil DB als Bottleneck angenommen wurde -- die Probe hat das widerlegt. Aggregator loest kein Performance-Problem, nur ein Coverage- und Outage-Problem. Coverage scheint nach heutigem Fix geloest, Outage-Frequenz ist nicht hoch genug fuer Aggregator-Welle.

**ABER** -- entscheiden tut die 7-Tage-Beobachtung, nicht der Bias. Wenn Coverage <85% bleibt, Option A; wenn 85-95%, Option B.

**Falsch waere jetzt:**
1. Option A bauen ohne Probe (10-14d Aufwand fuer unklaren ROI)
2. Option C bauen ohne 7-Tage-Probe (koennte echte Outage uebersehen)
3. Wir machen B als Mittelweg ohne Probe (Mittelweg-Reflex, V1 hat genau das gemacht)

**Phase-1 ist die Empfehlung. Phase-2-Wahl folgt Trigger-Schwellen.**

---

## 10. Phase-2-Migration-Plan (gilt fuer Option A; B/C haben eigene reduzierte Plaene)

```
Tag 1-3:   Implementation Option A -- Driver + Cursor + Service-File + Patch-RPC + Bucket-Test
Tag 4:     Smoke-Test gegen Hetzner-Box, DRY-RUN ohne Manifest-Write
Tag 5:     Manifest-Write Dual-Mode AN (Publisher + Aggregator parallel)
Tag 5-11:  7-Tage Coexistenz-Beobachtung
           - Daily: Coverage-Probe, Drift-Check, Outage-Detect
           - Cursor-Resume-Test bei manuellem SIGTERM
           - Sonntag 23:00 prune-Cron verifizieren
Tag 12:    Cut-over: Reader-Logik liest aggregator.* ?? publisher.*
Tag 13:    Publisher auf static Mode (NICHT mask), nur Trigger via Env
Tag 14:    Final-Audit + Memory-Updates
```

**Rollback-Plan (jeder Tag):**
- Reader-Logik faellt automatisch auf publisher.* wenn aggregator.* fehlt
- Aggregator-Service stoppen mit systemctl stop metastats-stats-aggregator.service
- Manifest-Reset via Publisher-Re-Run

---

## 11. Akzeptanzkriterien (hart, mit Schwellen)

**Phase 1 (Beobachtung-Akzeptanz):**
- [ ] 7 Tage Metriken-Sammlung im /internal/3d-ops Dashboard sichtbar
- [ ] One-Pager-Decision-Tree-Output dokumentiert (welche Option)
- [ ] Bucket-Drift-Probe fuer alle 4 RPCs durchgefuehrt

**Phase 2 Option A (Implementation-Akzeptanz):**
- [ ] p99 Cold-RPC < 500ms fuer Tail-Permutationen
- [ ] Manifest-Coverage > 95% real-existing-Permutationen
- [ ] 0 Function-Timeouts (HTTP 502) in 7d nach Cut-over
- [ ] Cursor-Resume nach SIGTERM mid-Endpoint funktioniert verifiziert
- [ ] Bucket-Fix fuer alle 4 RPCs gruen
- [ ] Patch-Resolver-Drift = 0 (alle Caller ueber RPC)
- [ ] Coverage actual_non_empty / expected_non_empty >= 99%

**Phase 2 Option B (Implementation-Akzeptanz):**
- [ ] Listing-Welle >=99% coverage
- [ ] Detail-Welle weiterhin publisher-resourced, kein Drift
- [ ] 0 Function-Timeouts in 7d nach Cut-over fuer Listing

**Phase 2 Option C (Implementation-Akzeptanz):**
- [ ] Publisher hat Try/Catch um jede Permutation
- [ ] Snapshot-Guard payload.hasData && payload.comp != null fuer alle Endpoints
- [ ] Listing-Welle als Pflicht-Bit deployed
- [ ] Patch-Resolver-SoT eingezogen

---

## 12. Aufwand-Schaetzung pro Option (realistisch, ehrlich)

| Phase / Option | Edit-Zeit | Multi-Review | Beobachtungs-Zeit | TOTAL |
|---|---|---|---|---|
| Phase 1 Setup + Beobachtung | 2h (Dashboard) | -- | 7d x 30min/Tag = ~3.5h | **~6h + 7 Kalendertage** |
| Phase 2 Option A | 10-14 Werktage Edit | ~4-6h parallel | 7d Coexistenz | **10-14d + 7 Kalendertage Coexistenz** |
| Phase 2 Option B | 3-5 Werktage Edit | ~2-3h parallel | 3d Probe | **3-5d + 3 Kalendertage** |
| Phase 2 Option C | 1-2 Werktage Edit | ~1-2h parallel | 2d Probe | **1-2d + 2 Kalendertage** |

**Vergleich mit V1-Schaetzung:** V1 sagte Aggregator-Welle ~5-7d realistisch. V2 sagt fuer Option A 10-14d -- Grund: V1-Multi-Review fand 15 echte Findings die alle Implementation-Zeit kosten. Das ist nicht Buffer, das ist die echte Median-Schaetzung NACH Multi-Review.

**Senior-Berater-Take:** Optionen B und C sind ehrlich attraktiver weil Phase-1-Probe sehr wahrscheinlich zeigen wird dass das System gesund ist. Option A nur bauen wenn Phase-1-Probe es zwingt.

---

## 13. Risiken & Mitigation

| Risiko | Wahrsch. | Impact | Mitigation |
|---|---|---|---|
| Phase-1-Beobachtung uebersieht Edge-Case | mittel | mittel | Decision-Tree dokumentiert + manuelle User-Freigabe vor Phase 2 |
| Bucket-Fix-Drift bei anderen RPCs | mittel | hoch | Probe in Phase 1 Tag 1, fix-it-while-you-have-it |
| Hetzner-Volume voll waehrend Aggregator-Run | niedrig | hoch | ExecStartPre Disk-Check (E10), monthly prune existing |
| Set-Bump 17-18 mitten in 7d-Coexistenz | niedrig | hoch | Set-Cursor-Reset-Logic (E8), keine Aggregator-Welle in Set-Bump-Woche planen |
| Aggregator-Service-Race mit Marktwert-Snapshot | mittel | mittel | After=marketvalue-snapshot.service + Pool-Serialisierung (A8) |
| Manifest-Drift zwischen Publisher und Aggregator | hoch | mittel | Single-Write-Lock + Reader-Fallback-Logik + Test-Snapshot in CI |
| Coexistenz-7d ist zu kurz fuer seltene Edge | niedrig | mittel | Phase-2-Wahl A erlaubt Verlaengerung auf 14d wenn Beobachtung Drift findet |

---

## 14. Probe-Scripts die Phase 1 braucht (Pflicht-Bauen)

| Script | Zweck | Aufwand |
|---|---|---|
| scripts/probe-manifest-coverage.mjs | Liest Manifest, vergleicht mit snapshot-matrix.ts Expected-Set, zaehlt non-empty | ~1.5h |
| scripts/probe-bucket-drift.mjs | Ruft 4 RPCs mit bucket=diamond_plus, verifiziert non-zero rows | ~1h |
| scripts/probe-patch-resolver-drift.mjs | Vergleicht inline-SQL vs RPC-Resolver, alertet bei Mismatch | ~1h |
| scripts/probe-edge-cache-hit-rate.mjs | Vercel-API-Call fuer Cache-Hit-Stats Default-Filter | ~1h |
| scripts/probe-aggregator-readiness.mjs | Daily-Cron, aggregiert obige + schreibt JSON nach /internal/3d-ops | ~1.5h |

**Phase-1-Setup Total ~6h.** Diese Scripts haben Wert AUCH wenn Option C gewaehlt wird (sie messen System-Health forever).

---

## 15. Non-Goals (was V2 BEWUSST nicht macht)

- KEIN Aggregator-bauen-erstmal-und-sehen -- Phase-1-Probe ist Pflicht
- KEINE Materialized-Views -- waeren eine 4. Option, aber data-skeptic-Verdict 06-21 sagt MV nur wenn tft_daily_crawl_meta zu gross wird, aktuell 2.170 Rows = OK
- KEINE Compute-Bump auf Small ohne Hot-Path-Reduktion -- reference_supabase_compute_quirks.md Eskalations-Treppe
- KEIN Read-Replica -- kommt erst bei wiederkehrenden Outages trotz Option A
- KEINE GH-Actions-Migration des Crawlers -- Quota-Constraint, Hetzner bleibt SoT
- KEIN Refactor des Publisher-Code-Pfads im selben Schritt -- Phase 2 ist additive, Phase 3 macht Cleanup

---

## 16. Memory-Pflege nach Phase 2

Bei Phase-2-Wahl folgende Memories updaten:
- reference_snapshot_first_pattern.md -- Aggregator-Pattern dokumentieren (Option A) ODER Listing-Welle-Pflicht-Bit dokumentieren (Option B+C)
- reference_crawler_architecture.md -- OnSuccess-Topologie um Aggregator-Service erweitern
- reference_tft_pipeline_ops.md -- Bucket-Gruppen-Falle-Update mit allen 4 RPCs verifiziert
- reference_supabase_outage_runbook.md -- neuen Cushion-Layer dokumentieren
- NEUE Memory reference_stats_aggregator_pattern.md bei Option A -- As-Built-Doku

---

==========================================================
WARTE AUF FREIGABE
==========================================================
Antwort-Optionen:
  - passt / ok / go / freigabe       -> Phase 1 Setup starten (Probe-Scripts bauen, Dashboard-Tab anlegen)
  - Adjustments im Prompt            -> Spec wird angepasst, neuer Spec-Run
  - autonom                          -> Auto-Approval, naechste Tasks ohne Spec-Pflicht bis explizit manuelle freigabe
==========================================================
