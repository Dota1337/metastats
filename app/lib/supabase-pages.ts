// PostgREST liefert hoechstens 1000 Zeilen je Abruf und schneidet still ab.
// Liest eine Abfrage vollstaendig in Seiten. `build` muss jedes Mal eine neue,
// eindeutig sortierte Abfrage liefern, sonst verrutschen Zeilen zwischen Seiten.
const PAGE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>;

export async function fetchAllPages<T>(
  build: () => { range(from: number, to: number): PageResult<T> },
): Promise<T[] | null> {
  const first = await build().range(0, PAGE - 1);
  if (first.error || !first.data) return null;
  const rows = [...first.data];
  if (rows.length < PAGE) return rows;
  for (let from = PAGE; ; from += PAGE) {
    const res = await build().range(from, from + PAGE - 1);
    if (res.error || !res.data) return null;
    rows.push(...res.data);
    if (res.data.length < PAGE) return rows;
  }
}
