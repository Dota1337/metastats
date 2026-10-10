# Overwolf-Store: Einreichung metastats.gg Companion

Paket: `npm run build` → `dist/metastats-companion-<version>.opk` (Version aus `public/manifest.json`).

## Schritte (Konto des Users, console.overwolf.com)

1. Developer-Konto anlegen bzw. anmelden, neue App anlegen. Name und Autor exakt wie im
   Manifest: „metastats.gg Companion“ / „metastats.gg“ — sonst aendert sich die App-Kennung
   und die Desktop-Verknuepfung zeigt ins Leere.
2. Das .opk in den Testkanal hochladen, intern pruefen, dann zur Pruefung einreichen.
3. Store-Seite mit dem Text unten fuellen, Symbole aus `public/images/`, Bilder aus
   `dist/store/` (Hauptfenster im Spiel, Comp-Liste, Comp-Overlay, Gegner-Tracker).
4. Datenschutz: https://www.metastats.gg/companion/privacy · Nutzungsbedingungen:
   https://www.metastats.gg/companion/terms · Impressum: https://www.metastats.gg/impressum

## Kurzbeschreibung (EN)

TFT companion by metastats.gg — tier list, comp picker, positioning, opponent tracker and item hints in game.

## Beschreibung (EN, Formular hoechstens 2.000 Zeichen)

metastats.gg Companion brings the Teamfight Tactics comps and statistics of metastats.gg into the game.

COMPS
- Tier list of the current meta comps with average placement, top 4 rate, win rate and pick rate.
- Per comp: units with their items, level plan, board for each player level (positioning) and early-game boards.
- Unit and item statistics, item recipes, shop odds and copies per unit.

IN GAME
- Comp picker: searchable list of comps, comps that fit your current board come first. Pin a comp to see its board, items and level plan in a small overlay.
- Item hints: when you choose an item, the app shows which unit of your pinned comp uses it or what it builds into.
- Shop highlight: units of your pinned comp are marked with a star in the shop.
- Opponent overlay (tracker like MetaTFT): each player's health, how many rounds ago you fought them and who you are unlikely to face next. Before stage 2-1 it also shows each player's rank and recent placements from our database. It does not show which comps your opponents are playing.
- "In game" tab in the main window with the same player list.

PROFILE
- Your rank and match history, including the boards of all eight players of each game. Search any player by name, with or without tag.

DISPLAY
- Main window on a second monitor, as an in-game overlay (Alt+D) or as a desktop window. Move the opponent overlay with Alt+M.
- English, German, Korean, Chinese, Spanish and French.

NOT INCLUDED
- No augment data is requested or shown. No win-chance predictions.

DATA
- If enabled (on by default, can be turned off in Settings), unit positions from the boards you see are sent to metastats.gg to build positioning statistics. Your Riot ID is replaced by a pseudonym within 48 hours. Privacy policy: https://www.metastats.gg/companion/privacy

## Anleitung je Fenster (Formularfeld „instructions for each window/tab“, hoechstens 2.000 Zeichen)

No ads in the app (no ad container).

Start: open the League client; the app starts with it. Start a TFT match (Normal or Ranked).

1. Main window ("main", desktop / second monitor) and "main_overlay" (same content as in-game overlay, Alt+D shows/hides it). Left sidebar:
- In game: only visible during a match. One row per player: health, rounds since you fought them, rank and recent placements.
- Comps: tier list. Click a comp: board per level, items, level plan, early-game boards, shop odds and recipes. "Pin" shows it in game.
- Units / Items: statistics, click a row for details.
- Match History: search a player by name (tag optional), open a match to see all 8 boards.
- Settings: display mode (auto / overlay / desktop), start with client, which overlays are shown, region, language, "Share board data for statistics" (on/off), move opponent overlay.
Right column: your own rank and last games.

2. "pinned" (comp overlay in game): without a pinned comp it shows a searchable comp list, comps with units already on your board first. Click a comp to pin it. Then: board per player level (switcher), recipes, shop odds at your level, level plan. ⇄ goes back to the list, × hides it for this match.

3. "matchup" (opponent overlay, next to the player list in game): one row per opponent with name, health and last fight; before stage 2-1 also rank and recent placements. Press Alt+M to move it, Alt+M again to lock it. Click-through otherwise.

4. "items" (item hints): appears above each card when the game offers an item choice. Shows which unit of your pinned comp uses it or what it builds into.

5. "shop": a yellow star on shop slots with units of your pinned comp. Pin a comp, then open the shop.

6. "background": no UI. Reads game events, starts the windows, sends board data if enabled.

Test account: any League account with TFT access works; no login in the app.

## Spieldaten, die die App liest

- TFT (5426 / 21570 / 28164): `gep_internal`, `me`, `match_info`, `store`, `board`, `roster`
  — eigener Name, Stufe, Shop, Brett, Mitspieler mit Leben, Gegner-Bretter, Item-Auswahl.
- League-Client (10902): `game_flow`, `lobby_info`, `summoner_info` — App mit dem Client
  oeffnen, Spielmodus.
- Rechte: GameInfo, Extensions, Hotkeys, DesktopStreaming.
- Gesendet wird: Brett-Positionen (abschaltbar in den Einstellungen, Riot-Name nach
  spaetestens 48 h pseudonymisiert), der eigene Riot-Name fuer das Profil, die Riot-Namen
  der Mitspieler fuer Rang und letzte Platzierungen (abschaltbar), Abrufe der oeffentlichen
  metastats.gg-Schnittstellen. Gegner-Bretter werden ohne Namen gesendet und nicht angezeigt.
