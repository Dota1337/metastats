// Gemeinsamer Zustand aller Fenster ueber localStorage.
//
// Alle Fenster der App laufen unter derselben Herkunft
// (overwolf-extension://<id>), teilen also localStorage und bekommen
// Aenderungen anderer Fenster als 'storage'-Ereignis. Overlays laden nie aus
// dem Netz.
//
// Wer schreibt welchen Schluessel (ab 0.8 verbindlich — patchSettings liest,
// aendert und schreibt ohne Sperre; zwei Schreiber koennen sich ueberholen):
//   ms.settings  nur Fenster: main (Einstellungen), pinned (Zuklappen),
//                matchup (Lage). Das Hintergrundfenster schreibt es NIE.
//   ms.pin       main (Anheften), pinned (Loesen, Auswahl im Spiel),
//                background (frische Zahlen derselben Comp)
//   ms.comps, ms.lookups, ms.itemStats   background und das Desktop-main (api.ts);
//                main_overlay laedt nicht selbst
//   ms.live, ms.me, ms.pinDetail, ms.resume, ms.lobby, ms.profile, ms.winpos,
//   ms.item      nur background
// Bestehende Schluessel und Felder nie umbenennen oder umdeuten: 0.7 muss
// den Speicher von 0.8 noch lesen koennen (Rueckweg).
import type {
  CompanionComp, CompanionCompDetail, CompanionCompsResponse, CompanionItemsResponse, CompanionLobbyEntry, CompanionLookups, CompanionPlayerResponse,
} from '../../../../app/lib/companion-types.ts';
import type { Lang } from './i18n.ts';
import type { OppBoard } from './boards.ts';
import type { RoundKind } from './gep.ts';
import type { OverlayName } from './windows.ts';
import type { MatchSnapshot } from './match-state.ts';

// Anzeige des Hauptfensters waehrend einer Partie (wie MetaTFT „Main App Display“):
// auto = zweiter Bildschirm, wenn vorhanden, sonst ueber dem Spiel; overlay =
// immer ueber dem Spiel; desktop = immer als Desktop-Fenster.
export type DisplayMode = 'auto' | 'overlay' | 'desktop';

export interface Settings {
  pinned: boolean;     // Comp-Overlay im Spiel
  shop: boolean;       // Shop-Markierung
  opponent: boolean;   // Gegner-Overlay: erkannte Comps der Gegner, auch ohne angeheftete Comp (ab 0.6)
  share: boolean;      // Brett-Daten senden
  region: string;
  lang: Lang | null;   // null = Overwolf-Sprache
  collapsed: boolean;  // Comp-Overlay zugeklappt
  // Lage des Gegner-Overlays als Anteil des Spielfensters (linke obere Ecke,
  // 0..1). null = Standardlage. Gesetzt im Verschiebe-Modus (ab 0.7).
  matchupPos: { x: number; y: number } | null;
  // Ab 0.8.
  mode: DisplayMode;
  startWithClient: boolean; // Hauptfenster zeigen, wenn der League-Client startet
  popupOnEnd: boolean;      // Hauptfenster nach einer TFT-Partie nach vorn (ohne Fokus)
  autoMove: boolean;        // Hauptfenster bei Spielstart auf einen Bildschirm ohne Spiel
  compPicker: boolean;      // Comp-Auswahl bei Spielstart zeigen, auch ohne angeheftete Comp
  items: boolean;           // Hinweise bei der Item-Auswahl
  scout: boolean;           // Lobby-Spieler (Rang, letzte Spiele) im Gegner-Overlay bis Stufe 2-1
}

export interface RosterRow { name: string; health: number | null; rank: number | null }

export interface Live {
  inTft: boolean;      // laeuft gerade eine TFT-Partie (nicht Kluft)
  level: number | null;
  shop: Array<string | null>; // 5 Plaetze, Unit-Kennung oder leer
  shopVisible: boolean;
  opponent: string | null;
  stage: string | null;
  oppBoards: Record<string, OppBoard>; // Gegnername -> sein vollstaendigstes zuletzt gesehenes Brett
  roster: RosterRow[];  // alle acht Spieler mit Leben und Platz (leer bis zur ersten Meldung)
  lobby: string | null; // Kennung der Partie, zu der oppBoards gehoert (Neustart mitten im Spiel)
  startedAt: number | null; // Beginn dieser Partie (Neustart mitten im Spiel: Spielverlauf bleibt eine Partie)
  moving: boolean;      // Verschiebe-Modus des Gegner-Overlays (nie ueber einen Neustart gerettet)
  updatedAt: number;
  // Ab 0.8.
  roundKind: RoundKind | null;      // Art der laufenden Runde
  pvp: Record<string, string>;      // Stufe ("3-2") -> Gegner dieser Kampfrunde, nur Spielerkaempfe
  queueId: number | null;           // Warteschlange laut League-Client, null = unbekannt
  dismissed: OverlayName[];         // in dieser Partie vom Spieler geschlossene Overlays
  myUnits: Array<{ id: string; star: number }>; // eigenes Brett (Comp-Auswahl im Spiel)
  wasTft: boolean;                  // diese Partie war sicher TFT (Popup und Umzug am Ende)
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
  // Ab 0.8.
  'ms.resume': MatchSnapshot | null; // Stand der laufenden Partie fuer einen Neustart; nur ein echtes Spielende loescht ihn
  'ms.lobby': { names: string; at: number; players: Record<string, CompanionLobbyEntry> } | null; // Mitspieler aus unserer Datenbank
  'ms.profile': (Cached<CompanionPlayerResponse> & { name: string }) | null; // eigenes Profil fuer die Live-Spalte
  'ms.winpos': { monitorId: string } | null; // Bildschirm, auf den der Nutzer das Hauptfenster im Spiel gelegt hat
  'ms.item': { offer: string[]; stage: string | null; at: number } | null; // offene Item-Auswahl, Karten von links nach rechts
  'ms.itemStats': Cached<CompanionItemsResponse> | null; // Item-Ergebnisse fuer die Item-Leiste im Spiel
}
export type StoreKey = keyof Schema;

// Altes Pausen-Flag der 0.1-App, damit ein Abschalten erhalten bleibt.
const LEGACY_PAUSED = 'metastats.companion.paused';

const DEFAULTS: { [K in StoreKey]: Schema[K] } = {
  'ms.settings': {
    pinned: true, shop: true, opponent: true, share: true, region: 'all', lang: null, collapsed: false, matchupPos: null,
    mode: 'auto', startWithClient: true, popupOnEnd: true, autoMove: true, compPicker: true, items: true, scout: true,
  },
  'ms.pin': null,
  'ms.comps': null,
  'ms.lookups': null,
  'ms.live': {
    inTft: false, level: null, shop: [], shopVisible: false, opponent: null, stage: null, oppBoards: {}, roster: [], lobby: null, startedAt: null, moving: false, updatedAt: 0,
    roundKind: null, pvp: {}, queueId: null, dismissed: [], myUnits: [], wasTft: false,
  },
  'ms.me': null,
  'ms.pinDetail': null,
  'ms.resume': null,
  'ms.lobby': null,
  'ms.profile': null,
  'ms.winpos': null,
  'ms.item': null,
  'ms.itemStats': null,
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
    if (key === 'ms.live') {
      const live = { ...DEFAULTS['ms.live'], ...(parsed as Live) };
      // Bis 0.6 stand je Gegner eine Liste von Unit-Kennungen; die wird verworfen.
      const boards: Record<string, OppBoard> = {};
      for (const [k, v] of Object.entries(live.oppBoards ?? {})) {
        if (v && typeof v === 'object' && Array.isArray((v as OppBoard).units)) boards[k] = v as OppBoard;
      }
      return {
        ...live, oppBoards: boards, roster: Array.isArray(live.roster) ? live.roster : [],
        pvp: live.pvp && typeof live.pvp === 'object' && !Array.isArray(live.pvp) ? live.pvp : {},
        dismissed: Array.isArray(live.dismissed) ? live.dismissed : [],
        myUnits: Array.isArray(live.myUnits) ? live.myUnits : [],
      } as Schema[K];
    }
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
