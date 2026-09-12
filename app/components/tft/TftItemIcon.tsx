import { tftIconUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';

// Reines Item-Bild ohne eigenen Link — fuer Stellen, die schon in einem Link
// stecken (z. B. die Zeilen der Champion-Liste, die komplett auf die
// Detailseite verlinken; ein <a> im <a> waere ungueltiges HTML).
// Hover-Titel = Item-Name aus dem Bundle.
export default function TftItemIcon({
  apiName,
  assets,
  className = 'w-6 h-6',
}: {
  apiName: string;
  assets: TftAssetsBundle | null;
  className?: string;
}) {
  const item = assets?.items[apiName];
  const url = tftIconUrl(assets, item?.icon);
  const title = item?.name || apiName;
  if (!url) {
    return (
      <span
        className={`${className} rounded bg-surface-overlay flex items-center justify-center text-[7px] text-fg-muted text-center leading-none overflow-hidden`}
        title={title}
      >
        {apiName.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?(?:Item_)?/, '').slice(0, 6)}
      </span>
    );
  }
  return <img src={url} alt={title} title={title} className={`${className} rounded`} loading="lazy" />;
}
