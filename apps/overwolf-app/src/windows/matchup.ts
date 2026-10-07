// Gegner-Overlay: fuer jeden Gegner, dessen zuletzt gesehenes Brett eindeutig
// zu einer Comp passt, Name und erkannte Comp. Der naechste Gegner steht oben.
// Braucht keine angeheftete Comp; ohne erkannte Comp bleibt es leer. Das
// Fenster ist durchklickbar und wird vom Hintergrundfenster neben die
// Spielerliste gesetzt.
import '../styles/app.css';
import { read, subscribe } from '../lib/store.ts';
import { boot } from '../lib/boot.ts';
import { fitSelf } from '../lib/ow.ts';
import { recognizeComp } from '../lib/plan.ts';
import { h, clear, tierBadge } from '../lib/dom.ts';

const root = document.getElementById('app')!;

function render(): void {
  const live = read('ms.live');
  const comps = read('ms.comps')?.data.comps ?? [];
  const rows = Object.entries(live.oppBoards)
    .map(([name, units]) => ({ name, comp: recognizeComp(units, comps, live.stage) }))
    .filter((r): r is { name: string; comp: NonNullable<typeof r.comp> } => r.comp != null)
    .sort((a, b) => Number(b.name === live.opponent) - Number(a.name === live.opponent));
  if (rows.length === 0) { clear(root); return; }
  const box = h('div', { class: 'overlay matchup' }, rows.map(r =>
    h('div', { class: r.name === live.opponent ? 'opp-row next' : 'opp-row' },
      h('span', { class: 'opp-name', title: r.name }, r.name.split('#')[0]),
      tierBadge(r.comp.tier),
      h('span', { class: 'ov-title', title: r.comp.name }, r.comp.name),
    ),
  ));
  clear(root, box);
  fitSelf(window.innerWidth, box.getBoundingClientRect().bottom + 2);
}

void boot(render);
subscribe(['ms.live', 'ms.comps'], render);
