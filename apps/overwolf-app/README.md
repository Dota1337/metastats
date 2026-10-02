# metastats.gg Companion (Overwolf App)

TFT-Begleiter mit den Daten von metastats.gg — das Gegenstück zur MetaTFT-App.

- **Hauptfenster (Alt+D):** Comps mit Tier, Schnitt-Platz, Top-4, Sieg, Units mit Items;
  Werkzeuge (Shop-Chancen je Stufe, alle Item-Rezepte, Stufenplan der angehefteten Comp);
  Spielerprofil mit Rang und letzten Partien; Einstellungen.
- **Im Spiel:** angeheftete Comp mit Rezepten, Shop-Chancen der aktuellen Stufe und
  Stufenplan; Rahmen um Shop-Plaetze mit Units dieser Comp; optional der naechste Gegner.
- **Im Hintergrund:** Brett-Positionen anonym an `/api/tft/positions/submit`
  (abschaltbar), Grundlage der Positions-Heatmap auf der Seite.

Bewusst NICHT drin: Augmente (weder angefordert noch angezeigt — Overwolf warnt vor
Sperre), Gewinnchance, Ladebildschirm-Scout, Speicher-Auslesen.

## Aufbau

```
src/windows/   ein HTML+TS je Overwolf-Fenster (background, main, pinned, shop, matchup)
src/lib/       store (gemeinsamer Zustand ueber localStorage), api, gep, plan, i18n, dom, ow
public/        manifest.json + Icons, landen unveraendert im Paket
```

Daten kommen von `/api/companion/v1/{comps,lookups,player}`. Antwort-Formen und Texte
teilt die App mit der Seite: `app/lib/companion-types.ts` und `app/lib/i18n-companion.ts`.

Das Hintergrundfenster ist der einzige Schreiber: es liest die Spielereignisse, schreibt
`ms.live`, laedt die Daten alle 30 Minuten und blendet die Overlays ein und aus. Die
Overlays lesen nur aus localStorage und warten nie aufs Netz.

## Bauen und testen

```
npm install
npm test          # reine Logik (gep, plan) mit node --test
npm run build     # tsc + vite → dist/app, danach dist/metastats-companion.opk
```

Lokal laden: Overwolf → Einstellungen → Ueber → Entwickleroptionen → „Load unpacked" →
`dist/app` waehlen. Konsole des Hintergrundfensters zeigt `[metastats-companion] ready`.

## Offen fuer den Test im Spiel

- Lage der Shop-Rahmen: aus einer 16:9-Flaeche geschaetzt (`placeShop` in
  `background.ts`, `SLOT_CENTERS` in `shop.ts`). Bei Abweichung dort nachziehen.
- Ob Overwolf `shop_visible` liefert; ohne das Ereignis gilt „Shop hat Units" als sichtbar.
