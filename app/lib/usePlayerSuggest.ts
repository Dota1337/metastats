'use client';
// Spieler-Vorschlaege beim Tippen fuer die Eingabefelder ausserhalb der
// Kopfleiste (LoL-Start, LoL-Vergleich, Mehrfachsuche, TFT-Vergleich). Quelle
// wie Nav.tsx: /api/tft/search-players, 150 ms entprellt, ab SUGGEST_MIN_CHARS.
//
//   - Eine Instanz je Formular, nicht je Feld (Felder entstehen teils in einer
//     Schleife): offen ist nur die Liste des Feldes, in dem zuletzt getippt
//     wurde, und nur dieses fragt an.
//   - Angefragt wird nur nach echter Eingabe (`update` aus onChange). Vorbelegung
//     aus der Adresse und das Einsetzen eines Vorschlags oeffnen nichts.
//   - Bis die naechste Antwort da ist, bleibt die vorige Liste stehen, damit sie
//     nicht bei jeder Taste kurz verschwindet. Fehler = keine Liste, das Feld
//     bleibt normal benutzbar. Eine „keine Treffer"-Zeile gibt es nicht: das
//     Verzeichnis kennt nur Spieler aus dem TFT-Crawl, getippte Namen gelten weiter.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { suggestQuery, type TftAccountHit } from './tft-player-search';

export type PlayerSuggest = ReturnType<typeof usePlayerSuggest>;

export function usePlayerSuggest(onPick: (hit: TftAccountHit, key: string) => void) {
  const listId = useId();
  // key = welches Feld, text = dessen Suchtext (Mehrfachsuche: die Zeile am Cursor)
  const [active, setActive] = useState<{ key: string; text: string } | null>(null);
  const [res, setRes] = useState<{ q: string; hits: TftAccountHit[] } | null>(null);
  const [hi, setHi] = useState<number | null>(null);
  // Element, unter dem die Liste steht (Feld oder ganze Suchleiste).
  const anchor = useRef<HTMLElement | null>(null);

  const q = active ? suggestQuery(active.text) : null;
  useEffect(() => {
    if (!q) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/tft/search-players?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { players?: TftAccountHit[] }) => {
          if (ctrl.signal.aborted) return;
          setRes({ q, hits: d.players || [] });
          setHi(null);
        })
        .catch(() => { if (!ctrl.signal.aborted) setRes(null); });
    }, 150);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q]);

  const hits = q && res ? res.hits : [];
  const open = hits.length > 0;

  const close = () => { setActive(null); setRes(null); setHi(null); };

  /** Aus onChange: Feld `key` hat jetzt `text`, die Liste haengt an `el`. */
  const update = (key: string, text: string, el: HTMLElement) => {
    anchor.current = el;
    // Anderes Feld oder unter der Schwelle: alte Treffer gehoeren nicht mehr dazu.
    if (key !== active?.key || !suggestQuery(text)) setRes(null);
    setHi(null);
    setActive({ key, text });
  };

  const pick = (hit: TftAccountHit) => {
    const key = active?.key;
    close();
    if (key != null) onPick(hit, key);
  };

  /** Vor dem eigenen onKeyDown des Feldes aufrufen; true = Taste verbraucht.
   *  Enter ohne Pfeil-Markierung bleibt beim Feld (Absenden bzw. neue Zeile). */
  const onKeyDown = (e: KeyboardEvent<HTMLElement>): boolean => {
    if (!open) return false;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHi(h => (h == null ? 0 : Math.min(h + 1, hits.length - 1)));
        return true;
      case 'ArrowUp':
        e.preventDefault();
        setHi(h => (h == null || h === 0 ? null : h - 1));
        return true;
      case 'Enter':
        if (hi == null || !hits[hi]) return false;
        e.preventDefault();
        pick(hits[hi]);
        return true;
      case 'Escape':
        // Schliesst nur — das Getippte bleibt stehen.
        e.preventDefault();
        close();
        return true;
      case 'Tab':
        close();
        return false;
    }
    return false;
  };

  const optionId = (i: number) => `${listId}-${i}`;

  /** ARIA + Browser-Autovervollstaendigung aus (deren Liste laege sonst ueber unserer). */
  const inputProps = (key: string) => {
    const mine = open && active?.key === key;
    return {
      role: 'combobox' as const,
      'aria-autocomplete': 'list' as const,
      'aria-expanded': mine,
      'aria-controls': listId,
      'aria-activedescendant': mine && hi != null ? optionId(hi) : undefined,
      autoComplete: 'off',
      onBlur: () => { if (active?.key === key) close(); },
    };
  };

  return { listId, optionId, open, hits, hi, setHi, pick, anchor, update, close, onKeyDown, inputProps };
}
