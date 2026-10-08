// Gegner-Overlay: je Gegner, dessen gesehenes Brett zu einer Comp passt, eine
// Zeile mit Name, Stufe des Bretts, Carries mit Sternen und Trait der Comp
// (sicher: mit Tier, wahrscheinlich: blasser, ohne Tier). Sortiert nach Leben,
// der naechste Gegner ist markiert. Braucht keine angeheftete Comp.
//
// Das Fenster ist durchklickbar; das Hintergrundfenster setzt es neben die
// Spielerliste. Im Verschiebe-Modus (Tastenkuerzel oder Einstellungen) nimmt
// es die Maus an und laesst sich ziehen; die neue Lage landet als Anteil des
// Spielbilds in den Einstellungen, das Hintergrundfenster setzt es dorthin.
import '../styles/app.css';
import { read, subscribe, patchSettings } from '../lib/store.ts';
import { boot } from '../lib/boot.ts';
import { fitSelf, dragSelf } from '../lib/ow.ts';
import { opponentRows } from '../lib/opponents.ts';
import { traitLabel } from '../lib/plan.ts';
import { rectFromGame, matchupFrac, toPixels, toFrac, clampPos } from '../lib/placement.ts';
import { t } from '../lib/i18n.ts';
import { h, clear, tierBadge, unitIcon } from '../lib/dom.ts';

const root = document.getElementById('app')!;
const log = (...a: unknown[]) => console.log('[metastats-companion]', ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))));

function render(): void {
  const live = read('ms.live');
  const comps = read('ms.comps')?.data.comps ?? [];
  const lookups = read('ms.lookups')?.data ?? null;
  const rows = opponentRows(live, comps);
  if (rows.length === 0 && !live.moving) { clear(root); return; }
  const box = h('div', { class: live.moving ? 'overlay matchup moving' : 'overlay matchup' },
    live.moving ? h('div', { class: 'ov-label' }, t('overlay.opponents')) : null,
    rows.map(r => {
      const label = r.rec.kind === 'sure' ? traitLabel(r.rec.comp) : r.rec.label;
      const full = r.rec.kind === 'sure' ? r.rec.comp.name : r.rec.label;
      return h('div', { class: r.next ? 'opp-row next' : 'opp-row' },
        h('div', { class: 'opp-head' },
          h('span', { class: 'opp-name', title: r.name }, r.short),
          h('span', { class: 'opp-stage' }, r.stage),
        ),
        h('div', { class: 'opp-comp' },
          r.rec.carries.map(c => unitIcon(c.unit, lookups, { stars: c.level, size: 'xs' })),
          h('span', { class: r.rec.kind === 'sure' ? 'opp-label' : 'opp-label likely', title: full }, label),
          r.rec.kind === 'sure' ? tierBadge(r.rec.comp.tier) : null,
        ),
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
  dragSelf(d => {
    if (!d) return;
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

void boot(render);
subscribe(['ms.live', 'ms.comps', 'ms.lookups'], render);
