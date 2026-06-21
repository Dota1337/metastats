# Roadmap-Specs Phase 3 — strategische Features

**Stand:** 2026-06-21
**Zugehörige Roadmap:** 11-Punkte-Plan aus Senior-Beratungs-Vorschlag, Phase 1+2 bereits deployed (Commits f02c689 + 4e4fce8). Diese Datei dokumentiert die offenen Punkte #8–#11 die wegen Aufwand mehrere Sessions brauchen.

---

## #8 Patch-Notes-Surface

**Ziel:** Eigene Page `/tft/patch/notes/[patch]` die Riot-Patch-Notes scraped + zu betroffenen Comps verlinkt. Patch-Day-Traffic-Driver.

**Architektur-Optionen (≥3 Alternativen mit Trade-offs):**

| Option | Quelle | Vorteil | Nachteil |
|---|---|---|---|
| A | Riot Patch-Notes HTML-Scrape | Offiziell, immer up-to-date, kein Lizenz-Risiko | HTML-Markup ändert sich pro Patch → fragiler Parser |
| B | tactics.tools Patch-Notes-Mirror | Strukturiert, durchsuchbar | Drittanbieter, ToS-Risiko, Abhängigkeit |
| C | Kuratiert (manuell + Community) | Komplette Kontrolle, eigene Highlight-Logik | Pflege-Aufwand pro Patch |

**Meine Empfehlung: A** — Scraper ist Standard-Webscrape, Riot ändert das Page-Layout nicht oft.

**Datenmodell:**
- Neue Tabelle `tft_patch_notes(patch text PK, published_at timestamp, raw_html text, parsed jsonb)`
- `parsed` jsonb enthält strukturierte Änderungen pro Champion/Trait/Augment/Item
- Reverse-Lookup: `change_target_apiName → patch+change_text`

**Pipeline:**
- Neuer Crawler `scripts/crawl-tft-patch-notes.mjs` läuft wöchentlich
- Scraped Riot's `https://www.leagueoflegends.com/en-us/news/tags/teamfight-tactics-patch-notes/`
- Parser extrahiert Liste der affected entities pro Patch
- Schreibt nach Supabase

**UI:**
- `/tft/patch/notes` Listing aller Patches mit Highlight-Stats
- `/tft/patch/notes/[patch]` Detail mit grouped Changes (Champions / Traits / Augments / Items)
- Pro Change: Link zur Entity-Detail-Page
- Bestehende `/tft/patch/winners` (existiert schon) verlinkt auf die Note der jeweiligen Comp-Änderungen

**Acceptance:**
- Crawler läuft wöchentlich erfolgreich
- DB hat ≥3 Patches gespeichert
- UI rendert pro Patch ≥80% der affected entities mit Detail-Link
- Bei neuem Patch innerhalb 24h Daten in DB

**Aufwand:** ~10-15h (Scraper bauen + DB-Migration + Parser-Edge-Cases + UI + i18n)

**Multi-Review-Pflicht vor Implementation:**
- data-skeptic (Sample-Validität bei alten Patches)
- architect (Storage-Backend-Wahl, Set-Migration-Pfad)
- logic-flow-critic (Scraper-Crash-Resume, Idempotenz)

---

## #9 Personalisierter Comp-Coach

**Ziel:** Auth-User sieht auf `/coach` (existiert lt. Memory bereits) eine personalisierte Comp-Empfehlung basierend auf Match-History. Zeigt:
- Stärken-Comps (Comps die User überdurchschnittlich gut spielt)
- Schwächen-Comps (Comps die User unterdurchschnittlich gut spielt)
- Empfehlungen (Comps die zum Skill-Cap passen, aber noch nie gespielt)

**Architektur-Optionen:**

| Option | Ansatz | Vorteil | Nachteil |
|---|---|---|---|
| A | Heuristik aus Match-Cache: Per-User vs Pop-Avg pro Comp | Schnell zu bauen, transparent | Sample-Größe pro User-Comp meist klein |
| B | ML-Modell (Collaborative Filtering) | Skaliert besser, „Nutzer wie du spielen auch X" | Cold-Start-Problem für neue User, schwer zu erklären |
| C | Hybrid: Heuristik + ML-Empfehlung für „neue Comps" | Beste UX | Doppelter Aufwand, zwei Engines warten |

**Meine Empfehlung: A** — als MVP, dann später ML drauflegen wenn Sample-Größe wächst.

**Datenmodell:**
- Nutzt existierende `tft_player_match_cache` + `tft_daily_comp_stats` (Aggregat-Vergleich)
- Neue View `tft_user_comp_performance` (per puuid + comp_cluster_key Aggregat)
- Empfehlungs-Algorithmus client-side: für User und Comp X
  - `user_avg_placement_X` vs `pop_avg_placement_X`
  - Z-Score-Berechnung analog Skill-Score
  - Stärke = Z-Score positiv, Schwäche = Z-Score negativ
  - Empfehlung = Comps mit `pop_avg_placement` < User-Skill-Cap aber User noch nie gespielt

**UI:**
- `/coach` erweitern um „Deine Stärken/Schwächen/Empfehlungen"-Section
- Pro Empfehlung: Comp-Card mit Begründung („du spielst Stargazer-Mountain mit Avg 3.4 — versuche dazu Stargazer-Serpent (3.6 für deine Skill-Klasse)")

**Acceptance:**
- Bei User mit ≥50 Matches in aktuellem Set: ≥5 Stärken-Comps + ≥5 Schwächen-Comps + ≥10 Empfehlungen
- UI rendert sinnvoll für Auth-User; nicht-eingeloggte sehen Login-CTA
- Performance: Empfehlungs-Berechnung <500ms

**Aufwand:** ~20-30h (Spec-Architect-Run pflicht: Z-Score-Kalibrierung, View-Performance, ML-Vs-Heuristik-Entscheidung)

**Multi-Review-Pflicht:**
- data-skeptic (Sample-Größe pro User-Comp, statistical-noise)
- architect (View vs Materialized-View, Storage-Strategie)
- perf-critic (Empfehlungs-Berechnung, Cache-Strategie)

---

## #10 Live-Lobby-Scout PWA für Mobile

**Ziel:** Mobile-PWA als Companion zum Overwolf-Desktop-Companion. Spieler sieht auf Handy was die anderen 7 Spieler in der Lobby spielen + Contested-Warning + Counter-Pick-Vorschläge.

**Architektur-Optionen:**

| Option | Architektur | Vorteil | Nachteil |
|---|---|---|---|
| A | PWA mit eigener Auth, polled API alle 30s | Standard-Stack, kein Overwolf-Lock-In | User muss aktiv Match-ID eingeben |
| B | Overwolf-Companion pushed Live-Daten via WebSocket zu PWA | Automatisch, kein User-Input | Komplexere Pipeline, WebSocket-Infrastruktur |
| C | PWA scraped Riot API direkt mit User's API-Key | Pure Client-Side | Riot-API-Key-Distribution für jeden User unmöglich |

**Meine Empfehlung: B** für End-State, **A** als MVP.

**Datenmodell:**
- Bestehende `tft_position_observations` als Source
- Neue Tabelle `tft_lobby_live(match_id, observed_at, observer_puuid, lobby_state jsonb)` für Live-Snapshots
- WebSocket-Push aus Overwolf-Companion mit HMAC-Signature

**Stack:**
- PWA via Next.js mit `manifest.json` + Service-Worker
- Auth-Sharing zwischen Desktop+Mobile via Supabase-Auth
- Push-Notifications für „Contested!" Warnings

**Acceptance:**
- Mobile-Page rendert sauber auf iPhone 12+ / Android 10+
- Auth-Sync funktioniert (Login auf Desktop → Mobile gleicher User)
- Lobby-Live-Data sichtbar innerhalb 30s nach Game-Start
- Counter-Pick-Suggestion basierend auf `comp.counters.losesTo`

**Aufwand:** ~3-4 Wochen (Spec-Architect-Run + Architect-Plan + ggf. CRDT-Synchronisation)

**Multi-Review-Pflicht:**
- architect (Auth-Sync, WebSocket-Infra, Storage)
- perf-critic (Polling-Frequenz, Battery-Drain auf Mobile)
- logic-flow-critic (Live-Push-Cascade, Reconnect-Logic)
- security-auditor (HMAC, Auth-Token-Sicherheit)

---

## #11 Pro-Match-Database mit Replay-Browser

**Ziel:** Durchsuchbare DB von Pro-Spielen, gefiltert nach Comp/Augment/Spieler/Patch. „Wie hat Dishsoap die Stargazer-Mountain in Patch 17.5 gespielt?"

**Architektur-Optionen:**

| Option | Datenquelle | Vorteil | Nachteil |
|---|---|---|---|
| A | Bestehender `tft_player_match_cache` filtered by `tft_pro_players.puuid` | Daten schon da, kein neuer Crawler | Cache hat Limit pro Spieler, ältere Matches fallen raus |
| B | Eigene Tabelle `tft_pro_matches` mit unbegrenzter Historie | Vollständige Pro-Datenbank | Storage-Aufwand, neuer Crawler |
| C | Liquipedia-Tournament-Match-Backfill | Komplette Tournament-Historie | Nur Tournaments, keine Solo-Queue |

**Meine Empfehlung: A** als MVP, **B** wenn User-Demand bestätigt.

**Datenmodell:**
- Bestehende Tabellen wiederverwenden
- Neue API `/api/tft/pro-matches?puuid=X&patch=Y&comp=Z` mit JOIN
- Frontend `/tft/pros/matches` als Filter-Page

**UI:**
- Filter-Sidebar: Player / Patch / Comp / Augment / Date
- Match-List mit Placement / Comp / Final-Board / Augments
- Pro Match: Detail-Modal mit kompletter Board-Visualisierung + Item-Build + Position-Heatmap

**Acceptance:**
- Search performt unter 1s auch bei 1000+ Matches
- Mindestens 20 Pro-Player abgedeckt
- Pro Match komplette Board-Daten sichtbar
- Filter-Combinations funktionieren ohne Frontend-State-Bug

**Aufwand:** ~20-25h

**Multi-Review-Pflicht:**
- data-skeptic (Cache-Größe vs Vollständigkeit)
- architect (Pagination, Index-Strategie)
- perf-critic (Search-Performance bei großem Filter-Range)

---

## Implementation-Reihenfolge (Empfehlung)

1. **#8 Patch-Notes** — schnellster Traffic-Driver, klar abgrenzbarer Scope (~2 Sessions)
2. **#11 Pro-Match-DB** — auf bestehender Daten-Pipeline bauend (~3 Sessions)
3. **#9 Personalisierter Coach** — braucht Spec-Architect-Run für ML-Vs-Heuristik (~5-7 Sessions)
4. **#10 Live-Lobby-Scout PWA** — größte Architektur-Investition (~10+ Sessions)

## Hygiene-Themen vor Phase-3-Start

- Live-Visual-Check der heutigen Phase-1+2-Deploys auf der Stargazer-Mountain-Lulu-URL
- Optional: Compare-Button auf der Comp-Listing-Page (User-Flow für #7)
- Recharts `next/dynamic` Lazy-Load aus Phase-1-Backlog
- Memory-Pair-Sync-Diszplin: nächste 4 Memories die bei Set 18 mit-migriert werden müssen

## Roadmap-Bestand nach Phase 1+2+3

**Deployed (Session 2026-06-21):**
- Phase 1 (`f02c689`): Active-Traits Drill-Down (#4), Sample-Validity-Gate (#2)
- Phase 2 (`4e4fce8`): Augment-Driven Comp-Picker (#5), Comp-Comparison-View (#7)
- Phase 3 (`a698cd0`): Recharts Lazy-Load (#3)
- UX-Follow-up (`0c44386`): Compare-Button auf Listing-Page

**Vorab erfüllt (existierte schon):**
- Family-Disclaimer (#1) via VariantsSwitcher-Banner
- Item-Pivot (#6) via /tft/items/[id] compsTop6+itemCombos+siblings

**Deferred (Mehr-Session-Aufwand):**
- Patch-Notes (#8) — Spec oben, Crawler-Foundation als nächster Schritt
- Personalisierter Coach (#9) — Spec oben
- Live-Lobby-Scout PWA (#10) — Spec oben
- Pro-Match-DB (#11) — Spec oben

## Was die heutige Session liefert

Aus 11 Punkten: **7 deployed** (6 voll + 1 als MVP-Phase-1) + **2 als-bereits-vorhanden bestätigt** + **3 als Spec dokumentiert** + **diverse UX-Polish**.

14 Commits gesamt in dieser Session:
- `f02c689` Phase 1 (#4 Active-Traits Drill-Down + #2 Sample-Validity-Gate)
- `4e4fce8` Phase 2 (#5 Augment-Comp-Picker + #7 Comp-Comparison-View)
- `7120467` Phase 3 Specs (#8-11)
- `5574848` Early-Game Lvl 4-7 Pivot-Tiles (User-Request)
- `a698cd0` Recharts-Lazy (#3)
- `0c44386` Compare-Button auf Listing
- `9e75b4c` Roadmap-Spec-Update Mid-Session
- `dcf4f28` Riot-Patch-Notes-Link (#8 MVP-Phase-1)
- `3f0811b` Star-4-Support + Active-Traits pro Boards-by-Activation
- `9fdc1da` Compare-from-Detail-Button (bidirektionaler Compare-Flow)

## Updated Roadmap-Bestand (Session-Ende 2026-06-21)

**Deployed (7/11):**
- #2 Sample-Validity-Gate ✓
- #3 Recharts Lazy-Load ✓
- #4 Active-Traits Drill-Down ✓
- #5 Augment-Driven Comp-Picker ✓
- #7 Comp-Comparison-View + Compare-Button-UX (Listing + Detail) ✓
- #8 Patch-Notes-Surface MVP-Phase-1 (Riot-Link) ✓

**Vorab erfüllt (2/11):**
- #1 Family-Disclaimer via VariantsSwitcher-Banner
- #6 Item-Pivot via /tft/items/[id]

**Offen (3/11):**
- #8 Patch-Notes-Phase-2 (Scraper + DB-Persistierung) — Spec
- #9 Personalisierter Coach — Spec
- #10 Live-Lobby-Scout PWA — Spec
- #11 Pro-Match-Database — Spec

**Plus UX-Polish die nicht im 11-Punkte-Plan war:**
- Star-4-Color-Support (Set-17-Bug-Fix)
- Active-Traits-Mini-Strip pro Boards-by-Activation-Level-Card
- Compare-Workflow bidirektional (Listing ↔ Detail)
- Early-Game Lvl-4-7 matched mit Pivot-Tiles

## Wer pflegt diese Datei

Bei jeder Implementation eines Punktes diese Datei aktualisieren mit konkretem Commit-Hash + Lessons-Learned. Bei neuem Set: Spec-Files in `infra/specs/<datum>-roadmap-*.md` archivieren oder im Repo-Git-History belassen.
