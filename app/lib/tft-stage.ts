// TFT internal round counter → "Stage X-Y".
//
// Riot reports the round a player was eliminated as a continuous counter, not
// stage notation: Stage 1 = rounds 1–4, then 7 rounds per stage. The input is
// rounded first so averages (e.g. last_round = 31.7) render as a clean
// "5-7" instead of "5-6.7" / the opaque raw number.
export function formatStage(round: number): string {
  const r = Math.round(round);
  if (r <= 0) return '—';
  if (r <= 4) return `1-${r}`;
  const offset = r - 4;
  const stage = Math.floor((offset - 1) / 7) + 2;
  const pos = ((offset - 1) % 7) + 1;
  return `${stage}-${pos}`;
}
