// Gemeinsamer Zustand aller Fenster ueber localStorage.
//
// Alle Fenster der App laufen unter derselben Herkunft
// (overwolf-extension://<id>), teilen also localStorage und bekommen
// Aenderungen anderer Fenster als 'storage'-Ereignis. Spieldaten (ms.live,
// ms.me) schreibt nur das Hintergrundfenster; die Fenster schreiben nur, was
// der Nutzer waehlt (ms.pin, ms.settings), das Hauptfenster zusaetzlich die
// geladenen Comps/Lookups, das Hintergrundfenster das Detail der angehefteten Comp. Overlays laden nie aus dem Netz.
import type { CompanionComp, CompanionCompDetail, CompanionCompsResponse, CompanionLookups } from '../../../../app/lib/companion-types.ts';
import type { Lang } from './i18n.ts';

export interface Settings {
  pinned: boolean;     // Comp-Overlay im Spiel
  shop: boolean;       // Shop-Markierung
  opponent: boolean;   // Gegner-Overlay: erkannte Comps der Gegner, auch ohne angeheftete Comp (ab 0.6)
  share: boolean;      // Brett-Daten senden
  region: string;
  lang: Lang | null;   // null = Overwolf-Sprache
  collapsed: boolean;  // Comp-Overlay zugeklappt
}

export interface Live {
  inTft: boolean;      // laeuft gerade eine TFT-Partie (nicht Kluft)
  level: number | null;
  shop: Array<string | null>; // 5 Plaetze, Unit-Kennung oder leer
  shopVisible: boolean;
  opponent: string | null;
  stage: string | null;
  oppBoards: Record<string, string[]>; // Gegnername -> Units seines zuletzt gesehenen Bretts
  updatedAt: number;
}

export interface Cached<T> { fetchedAt: number; data: T }

interface Schema {
  'ms.settings': Settings;
  'ms.pin': CompanionComp | null;
  'ms.comps': Cached<CompanionCompsResponse> | null;
  'ms.lookups': Cached<CompanionLookups> | null;
  'ms.live': Live;
  'ms.me': string | null; // eigener Riot-Name aus dem Spiel, fuer das Profil
  'ms.pinDetail': (Cached<CompanionCompDetail> & { key: string }) | null; // Detail der angehefteten Comp, laedt das Hintergrundfenster
}
export type StoreKey = keyof Schema;

// Altes Pausen-Flag der 0.1-App, damit ein Abschalten erhalten bleibt.
const LEGACY_PAUSED = 'metastats.companion.paused';

const DEFAULTS: { [K in StoreKey]: Schema[K] } = {
  'ms.settings': { pinned: true, shop: true, opponent: true, share: true, region: 'all', lang: null, collapsed: false },
  'ms.pin': null,
  'ms.comps': null,
  'ms.lookups': null,
  'ms.live': { inTft: false, level: null, shop: [], shopVisible: false, opponent: null, stage: null, oppBoards: {}, updatedAt: 0 },
  'ms.me': null,
  'ms.pinDetail': null,
};

export function read<K extends StoreKey>(key: K): Schema[K] {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) {
      if (key === 'ms.settings') {
        const paused = window.localStorage.getItem(LEGACY_PAUSED) === '1';
        return { ...DEFAULTS['ms.settings'], share: !paused } as Schema[K];
      }
      return DEFAULTS[key];
    }
    const parsed = JSON.parse(raw) as Schema[K];
    if (key === 'ms.settings') return { ...DEFAULTS['ms.settings'], ...(parsed as Settings) } as Schema[K];
    if (key === 'ms.live') return { ...DEFAULTS['ms.live'], ...(parsed as Live) } as Schema[K];
    return parsed;
  } catch {
    return DEFAULTS[key];
  }
}

const LOCAL_EVENT = 'ms-store';

export function write<K extends StoreKey>(key: K, value: Schema[K]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Speicher voll oder gesperrt: Fenster arbeiten dann mit dem alten Stand.
  }
  // 'storage' feuert nur in ANDEREN Fenstern; das eigene bekommt ein eigenes Ereignis.
  window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: key }));
}

export function patchSettings(p: Partial<Settings>): Settings {
  const next = { ...read('ms.settings'), ...p };
  write('ms.settings', next);
  return next;
}

export function subscribe(keys: StoreKey[], fn: (key: StoreKey) => void): () => void {
  const want = new Set<string>(keys);
  const onStorage = (e: StorageEvent) => { if (e.key && want.has(e.key)) fn(e.key as StoreKey); };
  const onLocal = (e: Event) => {
    const k = (e as CustomEvent<string>).detail;
    if (want.has(k)) fn(k as StoreKey);
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(LOCAL_EVENT, onLocal);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(LOCAL_EVENT, onLocal);
  };
}
