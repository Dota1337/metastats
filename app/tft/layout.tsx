import type { Metadata } from 'next';

// Ohne diesen Block erbt der komplette /tft-Baum den Titel des Wurzel-Layouts
// — und der spricht von League of Legends. Gemessen am 2026-09-01:
// `curl -s https://www.metastats.gg/tft/comps | grep -o '<title>[^<]*'`
// lieferte 'metastats.gg — League of Legends Statistiken & Marktwerte'.
//
// Statisch und einsprachig wie die beiden bereits bestehenden TFT-Metadaten
// (app/tft/onetricks/layout.tsx:3, app/tft/patch/winners/layout.tsx:3). Ein
// sprachabhaengiger Titel muesste das Sprach-Cookie im Server lesen und wuerde
// damit jede Route wieder unzwischenspeicherbar machen — genau das Problem, das
// im Wurzel-Layout ohnehin noch offen ist.
//
// Unterordner mit eigener `metadata` (onetricks, patch/winners) ueberschreiben
// das hier weiterhin; Next nimmt die naechstliegende Angabe.
export const metadata: Metadata = {
  title: 'TFT Meta — Comps, Units, Items & Traits · metastats.gg',
  description: 'Teamfight Tactics meta stats from ranked games: comps, units, items, traits and augments with average placement, top-4 share and pick rate by patch, rank and region.',
  openGraph: {
    title: 'TFT Meta — Comps, Units, Items & Traits',
    description: 'Teamfight Tactics meta stats from ranked games: comps, units, items and traits by patch, rank and region.',
    siteName: 'metastats.gg',
    type: 'website',
  },
};

// Anker für den Game-Accent (Design-Update Welle 1).
//
// CSS-Custom-Properties vererben nur abwärts. Der frühere Override auf
// `nav[data-game="tft"]` erreichte deshalb nur den Nav-Subtree: <Nav> wird
// zwar innerhalb von <main> gerendert, aber seine Geschwister dort erben
// nichts von ihm. Dieser Wrapper umschließt den kompletten /tft-Baum und ist
// damit der gemeinsame Vorfahre, den [data-game="tft"] in globals.css braucht.
//
// `display: contents` (Tailwind `contents`) hält die Änderung layout-neutral:
// das Element bleibt für die Vererbung im Baum, erzeugt aber keine Box und
// wird damit kein Flex-Item von <body className="min-h-full flex flex-col">.
//
// Server-Component ohne State — kein Client-JS, kein Flash beim First Paint.
// Bewusst NICHT über den metastats-game-Cookie: das Styling-Game ist eine
// reine Funktion des Pfads (siehe Kommentar in globals.css).
export default function TftLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div data-game="tft" className="contents">
      {children}
    </div>
  );
}
