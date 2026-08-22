import type { TftHeroUnit } from '../../lib/ddragon-splash';

// Ein Set-Splash am linken oder rechten Rand einer Kopfzone, nach innen
// ausblendend. Geteilt zwischen der Produktions-Kopfzone (`TftHero`) und der
// Vorschau unter /internal/design-lab — die Vorschau soll zeigen, was live
// steht, und nicht eine Kopie, die davon wegdriftet.
//
// `hidden sm:block`: auf dem Handy traegt die Kopfzone bewusst nur Text. Zwei
// 35-%-Bilder auf einem 360-px-Geraet waeren zwei schmale Ausschnitte aus einem
// Querformat direkt hinter der Ueberschrift. Die LoL-Kopfzone macht es an ihrer
// Seitenvariante genauso (app/components/PageHero.tsx:47).
//
// `fetchpriority="high"`: das Bild ist das groesste Element der Kopfzone und
// damit das LCP-Element. Ohne die Priorisierung konkurriert es mit den uebrigen
// Bildern der Seite um die HTTP/1.1-Verbindung zu ddragon.
//
// **Warum der Container am Bild-Seitenverhaeltnis haengt und nicht an 35 %:**
// ddragon liefert Splashes ausnahmslos in 1215x717 (1.695:1). Ein 35-%-Kasten
// ist bei 180 px Hoehe 667 px breit, also 3.7:1 — `object-cover` schnitt damit
// 54 % der Bildhoehe weg (gemessen auf /tft/units, Viewport 1920: sichtbar
// waren 46 %). Der Kasten traegt deshalb `aspect-ratio` und leitet seine Breite
// aus der Hoehe ab (305 px bei 180 px); `object-cover` hat dann nichts mehr zu
// schneiden.
//
// Bewusst NICHT `object-contain` bei 35 % Breite: das zeigt zwar auch das ganze
// Bild, laesst aber 362 px Leerraum je Seite — und der Verlauf ist ueber die
// vollen 667 px gestreckt, an der Bildkante also erst rund 45 % deckend. Das
// Bild bricht dort sichtbar hart ab.
//
// `maxWidth` deckelt fuer schmale Ansichten: reicht die Breite nicht,
// schrumpft der Kasten und `object-cover` schneidet wieder — das ist der alte
// Zustand und damit keine Verschlechterung.
//
// Die LoL-Kopfzone (`app/components/PageHero.tsx:47`) bleibt bei 35 % plus
// `object-cover`. Sie ist mit 222 px Hoehe weniger stark beschnitten (56 %
// sichtbar, gemessen auf /leaderboard), und der User hat ausdruecklich nur die
// TFT-Bilder beanstandet.
export default function TftHeroSideArt({
  unit,
  side,
  wide = false,
}: {
  unit: TftHeroUnit | null;
  side: 'left' | 'right';
  wide?: boolean;
}) {
  if (!unit) return null;
  return (
    <div
      className="hidden sm:block absolute top-0 bottom-0 overflow-hidden"
      style={{
        [side]: 0,
        // ddragon-Splashes sind ausnahmslos 1215x717.
        aspectRatio: '1215 / 717',
        maxWidth: wide ? '48%' : '35%',
        // Ohne das gewinnt `aspect-ratio` gegen `top-0 bottom-0`, sobald
        // `maxWidth` greift: der Kasten wird dann auch niedriger als die
        // Kopfzone und laesst unten einen Streifen frei (gemessen bei 700 px
        // Fensterbreite: 240x141 statt 240x180). Mit fester Hoehe bestimmt
        // `aspect-ratio` nur noch die Breite, und `object-cover` faengt den
        // geklammerten Fall ab.
        height: '100%',
      } as React.CSSProperties}
      aria-hidden="true"
    >
      <img
        src={unit.splash.url}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          filter: 'brightness(1.12)',
          // Solange der Kasten das Bild-Seitenverhaeltnis traegt, ist das ein
          // No-op. Es greift erst, wenn `maxWidth` den Kasten schmaler macht
          // als 1.695 x Hoehe — dann wird mittig beschnitten statt am Rand.
          objectPosition: 'center',
        }}
        fetchPriority="high"
        onError={e => {
          // KEIN Rueckfall auf den Grundskin: das Bild ist dann Artwork aus
          // einer anderen Zeit und faellt neben dem zweiten Set-Bild sofort
          // auf. Lieber eine leere Seite als ein fremdes Bild.
          (e.currentTarget as HTMLImageElement).style.opacity = '0';
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          // Bild aussen, Verlauf nach innen: links liegendes Bild blendet nach
          // rechts in die Flaeche aus, rechts liegendes nach links.
          background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, rgb(var(--surface-page-rgb) / 0%) 0%, rgb(var(--surface-page-rgb) / 15%) 60%, rgb(var(--surface-page-rgb) / 100%) 100%)`,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgb(var(--surface-page-rgb) / 0%) 0%, rgb(var(--surface-page-rgb) / 0%) 60%, rgb(var(--surface-page-rgb) / 100%) 100%)',
        }}
      />
    </div>
  );
}
