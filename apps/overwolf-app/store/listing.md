# Overwolf-Store: Einreichung metastats.gg Companion

Paket: `npm run build` → `dist/metastats-companion-<version>.opk` (Version aus `public/manifest.json`).

## Schritte (Konto des Users, console.overwolf.com)

1. Developer-Konto anlegen bzw. anmelden, neue App anlegen. Name und Autor exakt wie im
   Manifest: „metastats.gg Companion“ / „metastats.gg“ — sonst aendert sich die App-Kennung
   und die Desktop-Verknuepfung zeigt ins Leere.
2. Das .opk in den Testkanal hochladen, intern pruefen, dann zur Pruefung einreichen.
3. Store-Seite mit dem Text unten fuellen, Symbole aus `public/images/`, Bilder aus
   `dist/store/` (Hauptfenster im Spiel, Comp-Liste, Comp-Overlay, Gegner-Tracker).
4. Datenschutz: https://www.metastats.gg/datenschutz · Impressum: https://www.metastats.gg/impressum

## Kurzbeschreibung (EN)

TFT companion by metastats.gg — tier list, comp picker, opponent tracker and item hints in game.

## Beschreibung (EN)

metastats.gg Companion brings the comps and stats of metastats.gg into Teamfight Tactics.

- Comps tier list with average placement, top 4 and win rate, units with items, level plan and
  recipes; units, items and early-game boards.
- In game: pick a comp from a searchable list (comps that fit your board come first, contested
  comps are marked), see its board per level, shop odds and recipes as a small overlay.
- Opponent tracker: who you fought and when, who is unlikely to be next, recognized comps of
  the boards you scouted; before stage 2-1 rank and recent placements from our database.
- Item hints at item selection: which unit of your comp uses the item or what it builds into.
- Shop highlight for units of your comp.
- Main window on your second monitor, as overlay (one monitor) or as desktop window.
- Player profiles and match history with lobby boards; search by name without tag.

No augment data is requested or shown. No win-chance prediction.

## Spieldaten, die die App liest

- TFT (5426 / 21570 / 28164): `gep_internal`, `me`, `match_info`, `store`, `board`, `roster`
  — eigener Name, Stufe, Shop, Brett, Mitspieler mit Leben, Gegner-Bretter, Item-Auswahl.
- League-Client (10902): `game_flow`, `lobby_info`, `summoner_info` — App mit dem Client
  oeffnen, Spielmodus.
- Rechte: GameInfo, Extensions, Hotkeys, DesktopStreaming.
- Gesendet wird nur: anonyme Brett-Positionen (abschaltbar in den Einstellungen) und Abrufe
  der oeffentlichen metastats.gg-Schnittstellen.
