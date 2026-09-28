import { rankEmblemUrl } from '../../lib/cdragon-base';

// Das Emblem-Bild ist 1280×720 mit viel leerem Rand; bei object-contain bleibt
// in kleinen Groessen nur ein Pfeil sichtbar. Fester Ausschnitt (~340 px um
// die Bildmitte 640/345) fuer alle Stufen, damit Riots Groessenstaffel der
// Wappen als Rang-Signal erhalten bleibt.
export default function RankEmblem({ tier, label, className }: { tier: string | null | undefined; label: string; className: string }) {
  const src = rankEmblemUrl(tier);
  if (!src) return null;
  return (
    <span className={`relative inline-block overflow-hidden shrink-0 ${className}`}>
      <img
        src={src} alt={label} title={label}
        className="absolute max-w-none"
        style={{ width: '376.5%', left: '-138.2%', top: '-51.5%' }}
      />
    </span>
  );
}
