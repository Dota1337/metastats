'use client';
// Items-Seite (User 01.11.2026): alle Items in Reihen S+ bis C wie die
// Tier-Ansicht der Comps, Klick oeffnet rechts das Fenster zum Item.
//
// item, sort und type stehen in der Adresse, aber bewusst NICHT in URL_FILTER_KEYS:
// sonst schaltete ?item= die gespeicherten Filter ab, und Besucher saehen fremde
// Zahlen. Geschrieben werden sie nur ueber extraQuery (einziger Schreiber der
// Adresse bleibt useTftStatsList).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import EmptyData from '../../components/tft/EmptyData';
import StatsListPending from '../../components/tft/StatsListPending';
import ItemsFilterBar from '../../components/tft/ItemsFilterBar';
import ItemTierRows from '../../components/tft/ItemTierRows';
import ItemDetailPanel from '../../components/tft/ItemDetailPanel';
import TftHero from '../../components/tft/TftHero';
import { filtersToQueryString, type Filters } from '../../lib/tft-filters';
import type { StatsInitial } from '../../lib/seo/initial-data';
import { useTftStatsList } from '../../lib/useTftStatsList';
import { usePatchDelta } from '../../lib/usePatchDelta';
import { patchDeltaOf } from '../../lib/tft-patch-delta';
import { useI18n } from '../../lib/i18n';
import { loadItemTexts, type ItemTexts } from '../../lib/tft-item-texts';
import {
  filterItems, groupItemsByTier, isListedItem, itemExtraQuery, itemTierLetter,
  parseItemSort, parseItemTypes, type HolderSort, type ItemKind, type ItemRow, type ItemSortBy,
} from '../../lib/tft-item-tier-rows';

export type { ItemRow };

// Ab hier steht das Fenster neben den Reihen (lg in ItemDetailPanel). Darunter ist
// es ein Blatt, das die Seite verdeckt: dort muss Zurueck es schliessen.
const SHEET_QUERY = '(max-width: 1023.98px)';

// West/Asien stehen nicht im Regionen-Menue, nur in alten Links. Der Vergleich
// rechnet dort 8 s live und kommt ohne Ergebnis zurueck.
const noTrendRegion = (region: string) => region === 'west' || region === 'asia';

export default function ItemsClient({ initialFilters, initial, initialItem = null, initialSort = 'avg', initialType = [], initialTexts = null }: {
  // Vom Server (page.tsx), siehe UnitsClient.tsx.
  initialFilters: Filters;
  initial: StatsInitial<ItemRow> | null;
  initialItem?: string | null;
  initialSort?: ItemSortBy;
  initialType?: readonly ItemKind[];
  // Text nur des Items aus ?item=, damit er im ersten HTML steht.
  initialTexts?: ItemTexts | null;
}) {
  const { t, lang, withLang } = useI18n();
  const pathname = usePathname();
  const [selected, setSelected] = useState<string | null>(initialItem);
  const [sort, setSort] = useState<ItemSortBy>(initialSort);
  const [type, setType] = useState<readonly ItemKind[]>(initialType);
  const [search, setSearch] = useState('');
  // Hier statt im Fenster: am Handy schliesst man es vor jedem Item-Wechsel.
  const [holderSort, setHolderSort] = useState<HolderSort>('delta');

  const { filters, setFilters, rows: items, hasData, patches, dataEnd, loading, awaitingStored, assets } =
    useTftStatsList<ItemRow>({
      endpoint: '/api/tft/items',
      field: 'items',
      initialFilters,
      initial,
      extraQuery: itemExtraQuery({ item: selected, sort, type }),
    });

  // Next stellt beim Zurueck-Knopf die Props des ersten Aufrufs wieder her, die
  // Adresse traegt aber den letzten Stand (Fenster, „Alle ansehen", Zurueck).
  useLayoutEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    /* eslint-disable react-hooks/set-state-in-effect -- Absicht: Adresse gibt es erst im Browser, Angleich vor dem ersten Zeichnen */
    setSelected(sp.get('item'));
    setSort(parseItemSort(sp.get('sort')));
    // Gleicher Inhalt behaelt den Stand: sonst rechnet jeder Aufruf die Reihen neu.
    const nextType = parseItemTypes(sp.get('type'));
    setType(prev => (prev.join() === nextType.join() ? prev : nextType));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Pfeile immer gegen den Vorpatch, wie die Tier-Ansicht der Comps.
  const delta = usePatchDelta({ entity: 'item', filters, patches, dataEnd, prevOnly: true, enabled: !noTrendRegion(filters.region) });
  const trendingAvailable = !!delta.pair && !noTrendRegion(filters.region);
  const effectiveSort: ItemSortBy = sort === 'velocity' && !trendingAvailable ? 'avg' : sort;

  const tierRows = useMemo(() => groupItemsByTier(
    filterItems(items, { type, search, assets, lang }),
    { assets, sort: effectiveSort, deltaOf: id => patchDeltaOf(delta.index, id)?.deltaAvgPlace ?? null },
  ), [items, type, search, assets, lang, effectiveSort, delta.index]);

  // Aus allen Items, nicht aus den gefilterten: Suche und Art schliessen das
  // Fenster nicht.
  const selectedRow = selected && isListedItem(selected, assets) ? items.find(i => i.apiName === selected) ?? null : null;

  // Item im neuen Filter nicht vorhanden oder unbekannte Kennung: still zu.
  useEffect(() => {
    if (!selected || selectedRow || loading || awaitingStored || hasData === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Absicht: haengt an den frisch geladenen Zeilen
    setSelected(null);
  }, [selected, selectedRow, loading, awaitingStored, hasData]);

  // Texte: die volle Datei (48 KB) erst, wenn jemand auf das Raster zeigt oder ein
  // Item oeffnet. Der Klick danach hat den Text sofort.
  const [clientTexts, setClientTexts] = useState<ItemTexts | null>(null);
  const [textsDone, setTextsDone] = useState(false);
  const textsStarted = useRef(false);
  const startTexts = useCallback(() => {
    if (textsStarted.current) return;
    textsStarted.current = true;
    loadItemTexts().then(tx => { setClientTexts(tx); setTextsDone(true); });
  }, []);
  const serverHasText = !!(selected && initialTexts?.items?.[selected]);
  useEffect(() => { if (selected && !serverHasText) startTexts(); }, [selected, serverHasText, startTexts]);
  const panelTexts = clientTexts ?? (serverHasText ? initialTexts : null);
  const textsPending = !panelTexts && !textsDone;

  // Blatt am Handy: eigener Verlaufs-Eintrag, Zurueck schliesst. Am Desktop bleibt
  // es beim Ersetzen, dort sind die Filter daneben weiter bedienbar und Zurueck
  // zeigte sonst eine alte Adresse mit neuen Filtern.
  const pushedEntry = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const focusPanel = useRef(false);

  useEffect(() => {
    const onPop = () => {
      const id = new URLSearchParams(window.location.search).get('item');
      setSelected(id);
      if (!id) pushedEntry.current = false;
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const closePanel = useCallback(() => {
    const back = trigger.current;
    if (pushedEntry.current) window.history.back();
    else setSelected(null);
    if (back?.isConnected) back.focus({ preventScroll: true });
  }, []);

  const onSelect = useCallback((id: string, el: HTMLElement) => {
    if (id === selected) { closePanel(); return; }
    trigger.current = el;
    focusPanel.current = true;
    startTexts();
    if (!selected && window.matchMedia(SHEET_QUERY).matches) {
      pushedEntry.current = true;
      window.history.pushState(null, '', `${pathname}?${filtersToQueryString(filters)}${itemExtraQuery({ item: id, sort, type })}`);
    }
    setSelected(id);
  }, [selected, closePanel, startTexts, pathname, filters, sort, type]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, closePanel]);

  useEffect(() => {
    if (focusPanel.current && selectedRow) {
      focusPanel.current = false;
      panelRef.current?.focus({ preventScroll: true });
    }
  }, [selectedRow]);

  const filterQuery = `?bucket=${filters.bucket}&region=${filters.region}&days=${filters.days}`;
  const itemHref = useCallback(
    (id: string) => withLang(`/tft/items/${encodeURIComponent(id)}${filterQuery}`),
    [withLang, filterQuery],
  );
  const unitHref = useCallback(
    (id: string) => withLang(`/tft/units/${encodeURIComponent(id)}${filterQuery}`),
    [withLang, filterQuery],
  );

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="items" />
      <TftHero pageTitle={t('nav.items')} patch={patches[0]?.patch} />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-2 pb-6">
        <ItemsFilterBar
          filters={filters}
          patches={patches}
          onChange={setFilters}
          search={search}
          onSearch={setSearch}
          type={type}
          onType={setType}
          sort={effectiveSort}
          onSort={setSort}
          trendingAvailable={trendingAvailable}
        />

        {/* Steht immer im HTML: das Vorab-Skript blendet es ueber das <style>
            der Seite ein, solange gespeicherte Filter geladen werden. */}
        <StatsListPending show={(loading && hasData === null) || awaitingStored} />
        {hasData === false && !awaitingStored && <EmptyData />}

        {hasData && !awaitingStored && (
          <div data-e3-rows className="lg:flex lg:items-start lg:gap-4" onPointerEnter={startTexts} onFocusCapture={startTexts}>
            <ItemTierRows
              rows={tierRows}
              assets={assets}
              selected={selected}
              onSelect={onSelect}
              hrefOf={itemHref}
              deltaIndex={delta.index}
              pair={delta.pair}
            />
            {selectedRow && (
              <>
                <div className="fixed inset-0 z-[60] bg-black/60 lg:hidden" onClick={closePanel} aria-hidden="true" />
                <ItemDetailPanel
                  ref={panelRef}
                  item={selectedRow}
                  letter={itemTierLetter(selectedRow, assets)}
                  assets={assets}
                  texts={panelTexts}
                  textsPending={textsPending}
                  detailHref={itemHref(selectedRow.apiName)}
                  unitHref={unitHref}
                  holderSort={holderSort}
                  onHolderSort={setHolderSort}
                  onClose={closePanel}
                />
              </>
            )}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
