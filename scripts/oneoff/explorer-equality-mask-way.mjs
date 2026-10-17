// Masken-Weg als eingesteckter Weg fuer scripts/oneoff/explorer-query-equality.mjs:
//   --way=maske=scripts/oneoff/explorer-equality-mask-way.mjs
// Rechnet wie der Dienst ueber runMaskQuery auf derselben Kopie. Anfragen, die
// der Dienst nicht ueber die Masken schickt (ohne Filter/Rang/Level/Platz oder
// ein Tag der Patch-Wahl ohne Masken), laesst er aus.

import { loadMask, maskPlan, runMaskQuery } from '../lib/explorer-mask-query.mjs';

export async function makeWay(ctx) {
  const c = await ctx.holder.instance.connect();
  let mask;
  try {
    mask = await loadMask({ all: async (s) => (await c.runAndReadAll(s)).getRowObjectsJS(), log: ctx.log });
  } finally { c.closeSync?.(); }
  if (!mask) throw new Error('Masken in der Kopie nicht nutzbar');
  ctx.log(`Masken-Weg: ${mask.coveredDays} von ${mask.total} Tagen gedeckt`);
  const holder = { ...ctx.holder, mask };
  return {
    skip: (q) => !maskPlan(mask, q, holder.compHash),
    run: (q) => runMaskQuery(holder, q, maskPlan(mask, q, holder.compHash), { timeoutMs: ctx.timeoutMs }),
  };
}
