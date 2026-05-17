# metastats.gg Companion (Overwolf App)

Stille Background-Telemetrie für TFT. Sammelt Position- und Comp-Daten aus
laufenden Spielen via Overwolf's offizielle Game Events Provider (GEP),
sendet sie anonymisiert an `https://metastats.gg/api/tft/positions/submit`.

**Was die App NICHT tut:**
- Kein In-Game-Overlay mit Beratung (kein live coaching)
- Kein Augment-Display (Riot ToS verbietet das)
- Kein Memory-Reading (Vanguard-conform)
- Keine personenbezogenen Daten

## Voraussetzungen

1. Overwolf installiert: https://www.overwolf.com/install
2. Riot-Account mit aktivem TFT-Zugang
3. (Optional) Overwolf-Developer-Account für Loading der App im Dev-Modus

## Setup (Dev-Modus, lokal testen)

1. Overwolf starten und in den Dev-Modus wechseln:
   - Tray-Icon → Settings → About → Klick 7× auf das Logo (Easter-Egg)
   - Oder: Overwolf-Dock öffnen → Rechtsklick auf Dock → "Load Unpacked Extension..."
2. Im Dialog dieses Verzeichnis (`apps/overwolf-app/`) auswählen
3. Overwolf erkennt die `manifest.json` und installiert die App im Dev-Modus
4. App-Icon erscheint im Overwolf-Dock — Klick öffnet das Desktop-Fenster
5. TFT starten — Background-Window subscribed automatisch zum GEP

## Verifikation

In Overwolf's Developer-Console (Settings → Support → Developer Options → Open Dev Tools für `background.html`) sollten Log-Zeilen erscheinen:

```
[metastats-companion] background listener armed
[metastats-companion] setRequiredFeatures success
[metastats-companion] match_start
[metastats-companion] match_end placement 3
[metastats-companion] submit 200 47 observations
```

In Supabase prüfen:

```sql
select count(*), match_id from tft_position_observations
where observed_at > now() - interval '1 hour'
group by match_id;
```

## Architektur

```
TFT Game Client (Riot)
        ▼
Overwolf GEP (subscribes to game events)
        ▼
manifest.json — declares features
        ▼
windows/background.html → js/gep-tft.js
        ▼ (POST JSON)
https://metastats.gg/api/tft/positions/submit
        ▼ (upsert)
Supabase: tft_position_observations
        ▼ (aggregator, view)
tft_position_unit_cell (heatmap source)
        ▼ (RPC)
metastats.gg /tft/comps/[slug] (Position-Heatmap)
```

## Vor Store-Submission

- [ ] App-Icons in `images/` (256×256 PNG + ICO + grayscale-Variante + splash)
- [ ] App-Beschreibung übersetzt (zumindest EN + DE)
- [ ] Privacy-Policy auf metastats.gg verlinkt
- [ ] Terms of Service der App
- [ ] Demo-Video oder Screenshot der App-Funktion (Overwolf-Store-Pflicht)
- [ ] Overwolf-Store-Listing erstellen (Dev-Console → "New App")
- [ ] App-Review beantragen — Review dauert üblicherweise 5-10 Werktage

## Roadmap

**MVP** (jetzt):
- Background-Telemetrie für Board-Positionen
- Desktop-Fenster mit Pause-Toggle
- Backend-Endpoint + DB-Schema

**Phase 2** (~2 Wochen nach Store-Launch):
- Aggregator-Pipeline für Position-Heatmaps pro Comp-Cluster
- `tft_comp_unit_positions` Tabelle (groupBy comp × unit × cell)
- Frontend: Position-Heatmap-Sektion auf `/tft/comps/[slug]`

**Phase 3** (mid-term):
- Lobby-Scout-Funktion (optional sichtbar im Overwolf-Overlay-Fenster)
- Roll-/Level-Breakpoint-Live-Display
- Item-Cheat-Sheet (in-game window, Riot-ToS-konform)
- Match-Replay-Visualisierung auf metastats.gg

## Game-ID-Referenz

| ID | Game |
|---|---|
| 21570 | TFT + League of Legends (shared client) |
| 215701 | TFT PBE |

## Files

```
apps/overwolf-app/
├── manifest.json           # Overwolf app manifest
├── windows/
│   ├── background.html     # silent listener window
│   └── desktop.html        # user-facing settings window
├── js/
│   ├── gep-tft.js         # GEP subscription + submit
│   └── desktop.js         # pause toggle for desktop window
├── css/
│   └── desktop.css        # styling
├── images/                # icons + splash (TODO: produce assets)
└── README.md              # this file
```

## Quellen

- [Overwolf TFT Game Events](https://overwolf.github.io/api/games/events/teamfight-tactics)
- [Overwolf Dev Docs](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/teamfight-tactics/)
- [Riot Vanguard FAQ für 3rd-Party-Apps](https://www.riotgames.com/en/DevRel/vanguard-faq)
- [TFT-Scout Open-Source-Referenz](https://github.com/Jazcash/TFT-Scout)
