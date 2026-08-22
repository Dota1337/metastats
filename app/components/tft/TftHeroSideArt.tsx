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
// `fetchpriority="high"`: das Bild ist mit 35 % x 180 px das groesste Element
// der Kopfzone und damit das LCP-Element. Ohne die Priorisierung konkurriert es
// mit den uebrigen Bildern der Seite um die HTTP/1.1-Verbindung zu ddragon.
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
      style={{ [side]: 0, width: wide ? '48%' : '35%' } as React.CSSProperties}
      aria-hidden="true"
    >
      <img
        src={unit.splash.url}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          filter: 'brightness(1.12)',
          objectPosition: side === 'left' ? '70% 15%' : '30% 15%',
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
