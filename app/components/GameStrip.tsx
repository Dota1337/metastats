'use client';
import { useState, useEffect, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useI18n } from '../lib/i18n';
import { GAMES, GAME_COOKIE, detectGameFromPath, mapPathToGame, type Game } from '../lib/games';

// Vollbreiter Game-Streifen unter dem Prototyp-Banner. Ersetzt seit Welle 1.5
// die zwei Icon-Buttons, die vorher in der Nav-Leiste standen (GameSwitcher).
//
// WARUM ER IM ROOT-LAYOUT LIEGT UND NICHT IN Nav.tsx:
// <Nav> wird nicht vom Layout gerendert, sondern in 49 Seiten einzeln
// importiert — und app/loading.tsx ist ein Vollbild-Spinner ohne Nav. Ein
// Streifen in Nav.tsx würde bei jeder Navigation mitsamt der Nav unmounten,
// also 0,4-1,0 s genau in dem Fenster verschwinden, in dem er Orientierung
// geben soll, und auf TFT-Seiten 32 px Layout-Shift erzeugen (app/tft/
// loading.tsx reserviert nur h-14 für die Nav). Im Layout überlebt er die
// Transition und der optimistische Zustand mit ihm.

// Beschriftung des Ziel-Reveals. Deckt jeden Zielpfad ab, den mapPathToGame
// liefern kann — der Fallback ist der Spielname, nie eine geratene Seite.
type TKey = Parameters<ReturnType<typeof useI18n>['t']>[0];

const TARGET_LABELS: { match: RegExp; key: TKey }[] = [
  { match: /^\/(tft\/)?leaderboard/, key: 'nav.leaderboard' },
  { match: /^\/champions/,           key: 'nav.champions' },
  { match: /^\/tft\/units/,          key: 'nav.units' },
  { match: /^\/tft\/comps/,          key: 'nav.comps' },
  { match: /^\/(tft\/)?marktwert/,   key: 'nav.marketvalue' },
  { match: /^\/(tft\/)?compare/,     key: 'nav.analyse' },
  { match: /^\/ligen/,               key: 'nav.leagues' },
  { match: /^\/tft\/tournaments/,    key: 'drawer.tournaments' },
  { match: /^\/(tft\/)?player\//,    key: 'nav.searchPlayer' },
  { match: /^\/$/,                   key: 'gamestrip.home' },
];

export default function GameStrip() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname() || '/';
  const pathGame = detectGameFromPath(pathname);
  const [isPending, startTransition] = useTransition();
  const [pendingTarget, setPendingTarget] = useState<Game | null>(null);

  // Der angezeigte Zustand ist ABGELEITET, nicht gespeichert. Ein eigener
  // State, der per usePathname-Effect zurückgesetzt wird, bleibt beim
  // Zurück-Button dauerhaft falsch stehen: klickt man TFT und drückt Zurück,
  // bevor die Transition committet, landet man auf demselben Pfad — pathname
  // ändert sich nie, der Reset feuert nie. Hier fällt der Wert automatisch auf
  // pathGame zurück, sobald isPending endet.
  const shown = isPending && pendingTarget ? pendingTarget : pathGame;

  // Cookie mitschreiben. Dependency ist BEWUSST pathGame und nicht `shown` —
  // sonst schreibt der Effect während isPending einen Wert, zu dem der Nutzer
  // nie navigiert ist. (Gelesen wird der Cookie derzeit nirgends, siehe
  // app/lib/games.ts.)
  useEffect(() => {
    document.cookie = `${GAME_COOKIE}=${pathGame}; path=/; max-age=31536000; samesite=lax`;
  }, [pathGame]);

  // Internal-Ops-Dashboard läuft full-screen, wie beim Prototyp-Banner.
  if (pathname.startsWith('/internal')) return null;

  const targetLabel = (href: string) => {
    const hit = TARGET_LABELS.find(r => r.match.test(href));
    return hit ? t(hit.key) : null;
  };

  const go = (e: React.MouseEvent, target: Game, href: string) => {
    // Modifier-Klicks und Mittelklick dem Browser überlassen, damit
    // "in neuem Tab öffnen" funktioniert.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    // Guard gegen den ANGEZEIGTEN Zustand, nicht gegen den Pfad — sonst ist ein
    // zweiter Klick auf die bereits optimistisch aktive Hälfte kein No-op und
    // erzeugt einen zweiten History-Eintrag auf dasselbe Ziel.
    if (target === shown) return;
    // setState MUSS ausserhalb der Transition stehen. Innerhalb wäre es selbst
    // ein Transition-Update und würde erst mit der Navigation committen — die
    // Optimistik hätte dann exakt null Wirkung.
    setPendingTarget(target);
    startTransition(() => router.push(href));
  };

  return (
    <div className="game-strip" role="group" aria-label={t('game.switch')}>
      {GAMES.map(g => {
        const active = shown === g.id;
        const label = t(g.id === 'lol' ? 'game.lol' : 'game.tft');
        const href = mapPathToGame(pathname, g.id);
        // Offizielle Icons lokal gespiegelt, Herkunft siehe public/games/README.md
        const src = g.id === 'lol' ? '/games/lol-icon.png' : '/games/tft-icon.svg';
        const inner = (
          <>
            <img src={src} alt="" aria-hidden="true" className="game-strip-icon" />
            <span className="game-strip-label">{label}</span>
            {/* Reveal während isPending unterdrücken: pathname zeigt dann noch
                auf die alte Seite, das genannte Ziel wäre ein anderes als das,
                was der Klick nach dem Commit tatsächlich ansteuert. */}
            {!active && !isPending && targetLabel(href) && (
              <span className="game-strip-target" aria-hidden="true">{targetLabel(href)}</span>
            )}
          </>
        );
        return active ? (
          <span key={g.id} className="game-strip-half is-active" data-half={g.id} aria-current="true">
            {inner}
          </span>
        ) : (
          <a
            key={g.id}
            href={href}
            onClick={e => go(e, g.id, href)}
            className="game-strip-half"
            data-half={g.id}
            title={label}
          >
            {inner}
          </a>
        );
      })}
    </div>
  );
}
