// Was mit dem Hauptfenster passiert — reine Entscheidung (window-policy.test.ts).
// Das Hintergrundfenster fragt hier nach und fuehrt nur aus, eine Aktion nach
// der anderen, und loggt die Absicht.
//
// Lage waehrend einer Partie (Einstellung „Anzeige im Spiel“):
//   second   = Hauptfenster als Desktop-Fenster auf einem Bildschirm ohne Spiel
//   overlay  = eigenes Fenster main_overlay ueber dem Spiel (Alt+D)
//   desktop1 = nur ein Bildschirm, trotzdem Desktop-Fenster (nach vorn ohne Fokus)
// Fokus bekommt das Hauptfenster im Spiel nie von selbst: das wuerde das Spiel
// minimieren. Ausnahme: das Spiel hat den Fokus ohnehin nicht.
import type { DisplayMode } from './store.ts';

export type Trigger = 'click' | 'unknown' | 'client' | 'game-start' | 'hotkey' | 'game-end';
export type Layout = 'second' | 'overlay' | 'desktop1';

export interface PolicyInput {
  trigger: Trigger;
  mode: DisplayMode;
  monitors: number | null;     // null = unbekannt, zaehlt als 1
  inTft: boolean;              // TFT-Partie laeuft (sicher erkannt)
  gameFocused: boolean | null; // null = unbekannt
  mainVisible: boolean;
  overlayVisible: boolean;
  autoMove: boolean;
  startWithClient: boolean;
  popupOnEnd: boolean;
  wasTft: boolean;             // Spielende: die Partie war sicher TFT
  coldStart: boolean;          // Client-Start: die App ist gerade erst gestartet
  handled: boolean;            // Spielstart: fuer diese Partie schon gesetzt (Neustart der App)
  userShown: boolean;          // Spielstart: Nutzer hat main eben selbst geoeffnet
}

export type Step =
  | { op: 'main-show'; focus: boolean; move: boolean }
  | { op: 'main-minimize' }
  | { op: 'main-park' }        // auf dem Spiel-Bildschirm minimieren, sonst lassen
  | { op: 'overlay-show' }
  | { op: 'overlay-close' };

export interface Decision { layout: Layout; steps: Step[]; why: string }

export function layoutFor(mode: DisplayMode, monitors: number | null): Layout {
  const multi = (monitors ?? 1) >= 2;
  if (mode === 'overlay') return 'overlay';
  if (mode === 'desktop') return multi ? 'second' : 'desktop1';
  return multi ? 'second' : 'overlay';
}

const show = (focus: boolean, move: boolean): Step => ({ op: 'main-show', focus, move });

export function decide(i: PolicyInput): Decision {
  const layout = layoutFor(i.mode, i.monitors);
  const out = (steps: Step[], why: string): Decision => ({ layout, steps, why });

  switch (i.trigger) {
    case 'click':
      if (!i.inTft) return out([show(true, false)], 'click without game');
      if (i.gameFocused === false) return out([show(true, false)], 'click, game not focused');
      if (layout === 'second') return out([show(false, i.autoMove)], 'click in game, second screen');
      if (layout === 'overlay') return out([{ op: 'overlay-show' }], 'click in game, overlay');
      return out([show(false, false)], 'click in game, one screen desktop');

    case 'unknown':
      return i.inTft ? out([], 'unknown origin in game') : out([show(false, false)], 'unknown origin without game');

    case 'client':
      if (!i.startWithClient) return out([], 'client start off');
      if (!i.coldStart) return out([], 'client start, app already running');
      if (i.inTft) return out([], 'client start during game');
      return out([show(false, false)], 'client start');

    case 'game-start':
      if (i.handled) return out([], 'game start already handled');
      if (layout === 'second') {
        return i.autoMove ? out([show(false, true)], 'game start, move to second screen') : out([{ op: 'main-park' }], 'game start, auto move off');
      }
      if (i.userShown) return out([], 'game start, user just opened main');
      return out([{ op: 'main-minimize' }], `game start, ${layout}`);

    case 'hotkey':
      if (!i.inTft) return out([i.mainVisible ? { op: 'main-minimize' } : show(true, false)], 'hotkey without game');
      if (layout === 'overlay') return out([{ op: i.overlayVisible ? 'overlay-close' : 'overlay-show' }], 'hotkey in game, overlay');
      if (i.mainVisible) return out([{ op: 'main-minimize' }], 'hotkey in game, hide');
      return out([show(false, layout === 'second' && i.autoMove)], `hotkey in game, ${layout}`);

    case 'game-end': {
      const steps: Step[] = i.overlayVisible ? [{ op: 'overlay-close' }] : [];
      if (i.wasTft && i.popupOnEnd) steps.push(show(false, false));
      return out(steps, i.wasTft ? 'game end' : 'game end, not tft');
    }
  }
}
