// Naechster Gegner, nur wenn in den Einstellungen eingeschaltet.
import '../styles/app.css';
import { read, subscribe } from '../lib/store.ts';
import { t } from '../lib/i18n.ts';
import { boot } from '../lib/boot.ts';
import { makeDraggable } from '../lib/ow.ts';
import { h, clear } from '../lib/dom.ts';

const root = document.getElementById('app')!;

function render(): void {
  const live = read('ms.live');
  if (!live.opponent) { clear(root); return; }
  const box = h('div', { class: 'overlay matchup' },
    h('span', { class: 'ov-label' }, t('overlay.nextOpponent')),
    h('span', { class: 'opp' }, live.opponent),
    live.stage ? h('span', { class: 'muted' }, live.stage) : null,
  );
  makeDraggable(box);
  clear(root, box);
}

void boot(render);
subscribe(['ms.live'], render);
