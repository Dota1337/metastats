// PostgREST row filter for tft_pro_players PATCHes (CN wave, 2026-07-04).
//
// Rows are addressed by the surrogate `id` PK — NOT by puuid: CN pros have
// puuid NULL, and `puuid=eq.null` matches the text literal "null" → a silent
// 200-with-0-rows no-op that made enrichment invisible for puuid-less rows
// (data-skeptic 2026-07-04). id also sidesteps URL-encoding traps of CJK
// source_page titles (小寒). Every caller's SELECT must include `id`.
export function proRowFilter(p) {
  if (p?.id == null) {
    throw new Error(`proRowFilter: row has no id (select must include it) — ${p?.pro_name ?? 'unknown row'}`);
  }
  return `id=eq.${p.id}`;
}
