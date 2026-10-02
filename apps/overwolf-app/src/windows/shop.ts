// Shop-Markierung: ein durchklickbares Fenster ueber der Shop-Leiste. Ueber
// jedem Platz, der eine Unit der angehefteten Comp zeigt, liegt ein Rahmen.
import '../styles/app.css';
import { read, subscribe } from '../lib/store.ts';
import { shopMatches } from '../lib/plan.ts';
import { h, clear } from '../lib/dom.ts';

// Mitte der fuenf Plaetze relativ zur Fensterbreite. Das Fenster beginnt bei
// 24 % der Spielbreite und ist 53,5 % breit (background.ts placeShop); die
// Plaetze liegen bei ca. 29,7 / 40,3 / 50,9 / 61,5 / 72,1 % der Spielbreite.
const SLOT_CENTERS = [0.297, 0.403, 0.509, 0.615, 0.721].map(x => (x - 0.24) / 0.535);
const SLOT_WIDTH = 0.096 / 0.535;

const root = document.getElementById('app')!;

function render(): void {
  const pin = read('ms.pin');
  const live = read('ms.live');
  const hits = shopMatches(live.shop, pin);
  clear(root, h('div', { class: 'shop-strip' }, hits.map((hit, i) =>
    hit ? h('div', {
      class: 'shop-mark',
      style: `left:${((SLOT_CENTERS[i] - SLOT_WIDTH / 2) * 100).toFixed(2)}%;width:${(SLOT_WIDTH * 100).toFixed(2)}%`,
    }) : null,
  )));
}

render();
subscribe(['ms.pin', 'ms.live'], render);
