# Autonome Session — 2026-05-17 (Nacht)

User hat geschlafen, Berechtigung für autonome Arbeit erteilt.

## Was geliefert wurde

Commits seit `725b0dc` (Phase-1-Migration daily-crawl auf Hetzner):

| Commit | Was |
|---|---|
| `9518805` | **Block A**: scannable comps (CompRow), single-screen unit-page, edge-cache auf 5 stats-APIs |
| `c52403f` | **Block B**: tempo tag in CompRow (Fast 8 / Slow / Std), Lobby-Avg-Diff bei Player Top-Champions |
| `34ca091` | Sort-Dropdown + Difficulty-Tags (Items Dep / High WR / Consistent / etc.) |
| `253ec74` | `/tft/items/[id]`: Comps-mit-Item cross-query |
| `f595651` | **Bookmark-System** — localStorage, Star-Toggle auf CompRow + Player-Profil, `/tft/saved` page |
| `23fc682` | **Comp-Builder MVP** (`/tft/builder`) — click-to-add Board, Live-Trait-Activation, shareable URL |
| `83ccff5` | `/tft/traits/[name]`: Top-Comps-mit-Trait cross-query, Variant-Display |

## Was NICHT geliefert wurde (mit Begründung)

### Positioning-Grid (Block C1) — **gestrichen**

Match-V1 DTO enthält **keine Position-Daten** für units (nur `character_id`, `tier`, `items`). Verifiziert via direkter Postgres-Inspektion:

```json
{ "tier": 2, "items": [...], "characterId": "TFT17_Kindred" }
```

Konkurrenten (op.gg, blitz) kommen an Positioning nur über **eigene In-Game-Overlays** (Overwolf-basiert, lesen die lokale Riot-Client-API). Das ist Block D = mehrere Wochen Arbeit. Aggregator-v3 wäre verschwendet — daher **kein Aggregator-Run gestartet**.

### Supabase Auth (Block C3) — **verschoben**

Auth braucht OAuth-Provider-Setup (Google/Discord/etc.) im Supabase-Dashboard oder Email-SMTP-Config. Beides erfordert deine Hand am User-Side. Habe das **nicht ohne Setup gestartet**, weil es sonst halb-broken-State produziert. Sobald du das OAuth/SMTP-Setup machst, baue ich den Auth-Flow + Saved-Comps-Migration auf bestehende localStorage-Bookmark-API.

### Game-Reach-Multiplier — **wie besprochen verschoben**

Du hattest gesagt „Marktwert-Thema auf einen anderen Tag" — also nicht angefasst.

## Backfill-Status

Backfill v2 (12 Runs: 14./15./16.05 × euw1/kr/na1/eun1) läuft noch in **`kr/2026-05-14`** seit ~1.6h. KR hat 7.939 Master+ players (3-4× größer als EUW). ETA für kr/14.05: ~30-60 min. Total noch ~5-8h verbleibend.

Plus: ab **04:00 UTC** feuert `metastats-crawler.timer` (Marketvalue, täglich) und ab **05:15 UTC** der neu deployte `metastats-daily-crawl.timer` (daily-stats, täglich). Alle drei nutzen den TFT-Production-Key — geteiltes Rate-Limit. Erwartete Folge: Backfill v2 wird langsamer (50/3 ≈ 17 req/s effektiv), aber funktional. Daily-Crawls morgen früh: ebenfalls langsamer, sollten dennoch durch.

Wenn du das vermeiden willst: vor 04:00 UTC `systemctl stop metastats-crawler.timer metastats-daily-crawl.timer` auf Hetzner. Aber dann **fehlen morgen die fresh 17.05-Daten** — schlechter Trade-off.

## Was du morgens checken solltest

1. **Hetzner** — `systemctl status metastats-backfill metastats-crawler metastats-daily-crawl`. Alle drei sollten entweder `active (running)` oder `inactive (dead, exited successfully)` zeigen, **nicht** `failed`.
2. **Vercel-Deploys** — alle ~9 Commits sind durch gegangen (`tsc passed` jedes Mal).
3. **Live-Tests**:
   - `https://metastats.gg/tft/comps` — scannable Tabelle mit Sort-Dropdown + Difficulty-Tags
   - `https://metastats.gg/tft/builder` — Click ein paar Champions, schau Trait-Panel rechts
   - `https://metastats.gg/tft/saved` — Star ein paar Comps, Liste sollte auftauchen
   - `https://metastats.gg/tft/items/TFT_Item_GuinsoosRageblade` — sollte "Comps mit Item" rechts zeigen
4. **Supabase-Daten**:
   - `tft_player_marketvalue_snapshots` für `2026-05-15` sollte ≈ 1.651 rows haben (vom früheren Marketvalue-Backfill)
   - `tft_daily_comp_stats` für `2026-05-14` sollte für **mehrere Regionen** rows haben (vor diesem Backfill war nur br1 da)

## Nächste Schritte (nicht angefangen)

Reihenfolge wenn du wieder dran bist:
1. UI-Tests im Browser (für alle 9 Features) — Visuelle Polish-Issues sind erwartbar weil ich keine Live-Browser-Tests machen konnte
2. Augment-Backfill — Set 17 hat aktuell leere augments in Match-V1, kommt nach Riot-Patch zurück
3. Game-Reach-Multiplier (TFT × 0.75) — wenn du dich für Option A/B entscheidest
4. Supabase Auth — Email-Magic-Link am einfachsten zum Start
5. Overlay-App (Overwolf) — Major Block D, 4-8 Wochen

## Anti-Pattern-Memo

- **Nichts ohne tsc-Pass gepusht.** Jeder Commit hat den pre-push-Hook bestanden.
- **Keine Aggregator-Re-Runs ohne klaren Gewinn.** Positioning-Aggregator wäre verschwendet gewesen.
- **Keine Auth ohne deine Hand.** Halb-broken-State produziert mehr Probleme als wert.
- **Keine Konkurrenz-Feature-Cargo-Cult-Kopien.** Drag-and-Drop im Builder z.B. bewusst skipped weil 5-10× Code-Aufwand für reordering.

Gute Morgen.
