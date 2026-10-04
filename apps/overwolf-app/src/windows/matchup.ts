// Naechster Gegner: Name, seine erkannte Comp (aus dem zuletzt gesehenen
// Brett) und wie oft er damit vor deiner angehefteten Comp landet. Ohne
// gesehenes Brett oder bei unklarer Erkennung wird keine Comp geraten.
import '../styles/app.css';
import { read, subscribe } from '../lib/store.ts';
import { t } from '../lib/i18n.ts';
import { boot } from '../lib/boot.ts';
import { makeDraggable, fitSelf } from '../lib/ow.ts';
import { recognizeComp, opponentAhead } from '../lib/plan.ts';
import { h, clear, tierBadge } from '../lib/dom.ts';

const root = document.getElementById('app')!;
const WIDTH = 320;

function render(): void {
  const live = read('ms.live');
  if (!live.opponent) { clear(root); return; }
  const pin = read('ms.pin');
  const comps = read('ms.comps')?.data.comps ?? [];
  const theirs = recognizeComp(live.oppBoards[live.opponent] ?? [], comps, live.stage);
  const mu = pin && theirs ? opponentAhead(pin, theirs) : null;
  const box = h('div', { class: 'overlay' },
    h('header', { class: 'ov-head' },
      h('span', { class: 'ov-label' }, t('overlay.nextOpponent')),
      h('span', { class: 'ov-title' }, live.opponent),
      live.stage ? h('span', { class: 'muted' }, live.stage) : null,
    ),
    theirs ? h('div', { class: 'ov-comp-head' }, tierBadge(theirs.tier), h('span', { class: 'ov-title' }, theirs.name)) : null,
    theirs && pin && theirs.key !== pin.key
      ? h('div', { class: 'muted' }, mu ? t('overlay.oppAhead', { n: Math.round(mu.share * 100) }) : t('overlay.noMatchup'))
      : null,
  );
  makeDraggable(box);
  clear(root, box);
  fitSelf(WIDTH, box.getBoundingClientRect().bottom + 2);
}

void boot(render);
subscribe(['ms.live', 'ms.pin', 'ms.comps'], render);
