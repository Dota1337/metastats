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
