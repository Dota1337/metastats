# metastats.gg Companion (Overwolf App)

TFT-Begleiter mit den Daten von metastats.gg, aufgebaut wie die MetaTFT-App (0.8).

- **Hauptfenster (Alt+D):** Seitenleiste mit Im Spiel · Comps · Units · Items · Early Game ·
  Match History · Einstellungen, rechts die Live-Spalte mit dem eigenen Profil (Rang, letzte
  Platzierungen, letzte Bretter). Spielersuche auch ohne #Tag (Trefferliste mit Server).
- **Im Spiel:** Reiter „Im Spiel“ mit allen Mitspielern (Leben, zuletzt gegen, Rang, letzte
  Platzierungen, erkannte Comp). Anzeige je nach Einstellung auf dem zweiten Bildschirm, als
  Overlay ueber dem Spiel (`main_overlay`) oder als Desktop-Fenster.
- **Overlays:** angeheftete Comp mit Comp-Auswahl (Suche, passende Comps zum eigenen Brett,
  Gegner mit denselben Carries), Gegner-Tracker (wann zuletzt gegen wen, wer als naechstes
  unwahrscheinlich ist; vor 2-1 Rang und Platzierungen), Shop-Stern, Item-Hinweise bei der
  Item-Auswahl.
- **Im Hintergrund:** Brett-Positionen anonym an `/api/tft/positions/submit` (abschaltbar).

Bewusst NICHT drin: Augmente (weder angefordert noch angezeigt — Overwolf warnt vor Sperre),
Gewinnchance, Ladebildschirm-Scout, Speicher-Auslesen.

## Aufbau

```
src/windows/   ein HTML+TS je Fenster (background, main, main_overlay, pinned, shop, matchup, items)
src/windows/main/  Reiter des Hauptfensters
src/lib/       store (gemeinsamer Zustand ueber localStorage), api, gep, Regeln mit Tests
               (window-policy, monitors, match-state, tracker, item-advice, comp-search, launch)
public/        manifest.json + Icons, landen unveraendert im Paket
tools/         install-shortcuts.ps1 (Desktop- und Startmenue-Verknuepfung)
```

Daten kommen von `/api/companion/v1/{comps,comp,lookups,units,items,player,lobby,search}`.
Antwort-Formen und Texte teilt die App mit der Seite: `app/lib/companion-types.ts` und
`app/lib/i18n-companion.ts`. Welches Fenster welchen Speicher-Schluessel schreibt, steht im
Kopf von `src/lib/store.ts`; das Hintergrundfenster steuert alle Fenster.

## Bauen und testen

```
npm install
npm test          # Regeln mit node --test
npm run build     # tsc + Tests + vite → dist/app, danach dist/metastats-companion-<version>.opk
```

Lokal laden: Overwolf → Einstellungen → Ueber → Entwickleroptionen → „Load unpacked" →
`dist/app` waehlen. Das Log des Hintergrundfensters zeigt `[metastats-companion] ready <version>`.

## Starten wie ein Programm

`npm run shortcuts` legt „metastats.gg Companion“ auf dem Desktop und im Startmenue an
(`OverwolfLauncher.exe -launchapp <uid> -from-desktop`, derselbe Weg wie bei Store-Apps).
Ein Doppelklick startet Overwolf, falls noetig, und oeffnet die App; Overwolf meldet den Start
als `commandline` (gemessen im Trace-Log), die App zeigt dann das Hauptfenster.
`npm run shortcuts -- -Remove` entfernt beide. Laeuft Overwolf als Administrator, fragt
Windows beim Doppelklick nach Freigabe — das gilt fuer alle Overwolf-Verknuepfungen.

Nur fuer diesen PC: Fremde Konten blocken nicht veroeffentlichte Apps. Fuer andere Spieler
fuehrt der Weg ueber den Overwolf-Store (`store/listing.md`).

## Offen fuer den Test im Spiel

- Lage der Item-Hinweise (`.items-row` in `app.css`, `ITEMS_SIZE` in `placement.ts`) und der
  Shop-Sterne (`SLOT_CENTERS` in `shop.ts`): aus einer 16:9-Flaeche geschaetzt.
- Gegner-Vorhersage: jede Kampfrunde steht als `matchup check` im Log (beide Zaehlweisen).
- Umzug auf den zweiten Bildschirm, Overlay-Hauptfenster, Start mit dem League-Client.
