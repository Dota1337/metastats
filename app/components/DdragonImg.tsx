'use client';

import { useDdragonVersion } from '../lib/ddragon-version';

// Bild von DataDragon mit der aktuellen Version. Bis die Version da ist,
// steht ein gleich grosser leerer Platzhalter — kein Layout-Sprung.
export default function DdragonImg({ path, className = '', alt = '', title }: {
  path: string;
  className?: string;
  alt?: string;
  title?: string;
}) {
  const version = useDdragonVersion();
  if (!version) return <span aria-hidden className={`inline-block ${className}`} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://ddragon.leagueoflegends.com/cdn/${version}/${path}`} alt={alt} title={title} className={className} />
  );
}
