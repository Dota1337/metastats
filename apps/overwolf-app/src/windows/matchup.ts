// Gegner-Overlay (Tracker wie bei MetaTFT): je lebendem Gegner, sortiert nach
// Leben, Name, wann man zuletzt gegen ihn gekaempft hat (lib/tracker.ts) und
// Leben. Zweite Zeile: vor Stufe 2-1 Rang und letzte Platzierungen aus unserer
// Datenbank (Scout, abschaltbar), danach die erkannte Comp seines Bretts
// (sicher: mit Tier, wahrscheinlich: blasser). Braucht keine angeheftete Comp.
//
// Das Fenster ist durchklickbar; das Hintergrundfenster setzt es neben die
// Spielerliste. Im Verschiebe-Modus (Tastenkuerzel oder Einstellungen) nimmt
// es die Maus an und laesst sich ziehen; die neue Lage landet als Anteil des
// Spielbilds in den Einstellungen, das Hintergrundfenster setzt es dorthin.
import '../styles/app.css';
import { read, subscribe, patchSettings } from '../lib/store.ts';
import { boot } from '../lib/boot.ts';
import { fitSelf, dragSelf, rememberSelf } from '../lib/ow.ts';
import { opponentRows } from '../lib/opponents.ts';
import { trackRows } from '../lib/tracker.ts';
import { trackLabel, rankShort, placeChips } from '../lib/track-view.ts';
import { stageToRound } from '../lib/gep.ts';
import { traitLabel } from '../lib/plan.ts';
import { rectFromGame, matchupFrac, toPixels, toFrac, clampPos } from '../lib/placement.ts';
import { t } from '../lib/i18n.ts';
import { h, clear, tierBadge, unitIcon } from '../lib/dom.ts';

const root = document.getElementById('app')!;
const log = (...a: unknown[]) => console.log('[metastats-companion]', ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))));

// Scout-Zeile bis einschliesslich Stufe 1-4 (vor dem ersten Spielerkampf).
const SCOUT_UNTIL = 21;

// Waehrend des Ziehens nicht neu zeichnen: fitSelf aendert sonst mitten im
// dragMove die Fenstergroesse. Danach einmal nachzeichnen; die Sicherung
// greift, falls Overwolf das Ende nie meldet.
const DRAG_GUARD_MS = 30_000;
let dragging = false;
let dragGuard: ReturnType<typeof setTimeout> | null = null;

function endDrag(): void {
  if (dragGuard) { clearTimeout(dragGuard); dragGuard = null; }
  if (!dragging) return;
  dragging = false;
  render();
}

function render(): void {
  if (dragging) return;
  const live = read('ms.live');
  const settings = read('ms.settings');
  const comps = read('ms.comps')?.data.comps ?? [];
  const lookups = read('ms.lookups')?.data ?? null;
  const { rows } = trackRows({
    pvp: live.pvp, roster: live.roster, stage: live.stage, roundKind: live.roundKind,
    queueId: live.queueId, me: read('ms.me'),
  });
  const alive = rows.filter(r => !r.dead).sort((a, b) => (b.hp ?? -1) - (a.hp ?? -1));
  if (alive.length === 0 && !live.moving) { clear(root); fitSelf(1, 1); return; }
  const recs = new Map(opponentRows(live, comps).map(r => [r.name, r.rec]));
  const round = stageToRound(live.stage);
  const lobby = settings.scout && (round == null || round < SCOUT_UNTIL) ? read('ms.lobby')?.players ?? null : null;

  const box = h('div', { class: live.moving ? 'overlay matchup moving' : 'overlay matchup' },
    live.moving ? h('div', { class: 'ov-label' }, t('overlay.opponents')) : null,
    alive.map(r => {
      const rec = recs.get(r.name);
      const scout = lobby?.[r.name];
      const rank = scout?.found ? rankShort(scout) : null;
      const second = scout?.found && (rank || scout.recent.length)
        ? h('div', { class: 'opp-comp' },
          rank ? h('span', { class: 'opp-rank' }, rank) : null,
          scout.recent.length ? placeChips(scout.recent, 5) : null)
        : rec
          ? h('div', { class: 'opp-comp' },
            rec.carries.map(c => unitIcon(c.unit, lookups, { stars: c.level, size: 'xs' })),
            h('span', { class: rec.kind === 'sure' ? 'opp-label' : 'opp-label likely', title: rec.kind === 'sure' ? rec.comp.name : rec.label },
              rec.kind === 'sure' ? traitLabel(rec.comp) : rec.label),
            rec.kind === 'sure' ? tierBadge(rec.comp.tier) : null)
          : null;
      return h('div', { class: r.status === 'now' ? 'opp-row next' : 'opp-row' },
        h('div', { class: 'opp-head' },
          h('span', { class: 'opp-name', title: r.name }, r.name.split('#')[0]),
          trackLabel(r),
          r.hp != null ? h('span', { class: 'opp-hp' }, String(r.hp)) : null,
        ),
        second,
      );
    }),
  );
  if (live.moving) box.addEventListener('mousedown', startDrag);
  clear(root, box);
  const rect = box.getBoundingClientRect();
  fitSelf(rect.right + 2, rect.bottom + 2);
}

// Neue Lage nach dem Ziehen. Overwolf meldet die Verschiebung und die neue
// Fensterlage; beide werden protokolliert, bis feststeht, dass sie bei
// Bildschirm-Skalierung uebereinstimmen. Massgeblich ist die Verschiebung ab
// der gespeicherten Lage — in derselben Einheit, in der das Hintergrundfenster
// das Overlay setzt.
function startDrag(e: MouseEvent): void {
  if (e.button !== 0) return;
  const from = matchupFrac(read('ms.settings').matchupPos);
  dragging = true;
  dragGuard = setTimeout(endDrag, DRAG_GUARD_MS);
  dragSelf(d => {
    endDrag();
    if (!d) { log('overlay drag', { action: 'no move' }); return; }
    overwolf.games.getRunningGameInfo(g => {
      const r = rectFromGame(g?.logicalWidth || g?.width, g?.logicalHeight || g?.height);
      if (!r) { log('overlay drag', { action: 'no game' }); return; }
      const start = toPixels(from, r);
      const byDelta = d.dx != null && d.dy != null ? { left: start.left + d.dx, top: start.top + d.dy } : null;
      const byWindow = d.after ? { left: d.after.left, top: d.after.top } : null;
      const px = byDelta ?? byWindow;
      log('overlay drag', { byDelta, byWindow, rect: r });
      if (!px) return;
      const pos = clampPos(toFrac(px.left, px.top, r));
      if (Math.abs(pos.x - from.x) < 1e-4 && Math.abs(pos.y - from.y) < 1e-4) return;
      patchSettings({ matchupPos: pos });
    });
  });
}

rememberSelf();
void boot(render);
subscribe(['ms.live', 'ms.comps', 'ms.lookups', 'ms.lobby', 'ms.me', 'ms.settings'], render);
