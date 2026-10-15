'use client';
import { useI18n } from '../../lib/i18n';

// Ladeanzeige der Statistik-Listen (Comps, Units, Items, Traits, Atlas):
// graue Platzhalter-Balken statt eines Satzes (User 2026-10-15, F1-B). Vorher
// stand hier `t('tft.noDataYet').replace('Noch keine Daten', 'Lade')` — die
// Ersetzung griff nur auf Deutsch, alle anderen Sprachen lasen „No data yet".
//
// Der aeussere Block bleibt immer im HTML und traegt data-e3-wait: das <style>
// der Server-Seite blendet ihn mit `display:block!important` ein, solange
// gespeicherte Filter laden (app/lib/seo/stats-pending.ts). Deshalb liegen die
// Balken INNEN — ein flex/grid direkt auf diesem Block wuerde die Regel
// ueberschreiben. Screenreader hoeren den Ladetext, die Balken sind stumm.
export default function StatsListPending({
  show,
  e3 = true,
  rows = 6,
  rowHeight = 'h-12',
}: {
  show: boolean;
  /** false auf reinen Browser-Seiten ohne Server-Startdaten (Atlas). */
  e3?: boolean;
  rows?: number;
  rowHeight?: 'h-12' | 'h-20';
}) {
  const { t } = useI18n();
  return (
    <div data-e3-wait={e3 ? '' : undefined} className={show ? '' : 'hidden'}>
      <div role="status">
        <span className="sr-only">{t('tft.loading')}</span>
        <div aria-hidden="true" className="space-y-2">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className={`${rowHeight} rounded bg-surface-raised motion-safe:animate-pulse`} />
          ))}
        </div>
      </div>
    </div>
  );
}
