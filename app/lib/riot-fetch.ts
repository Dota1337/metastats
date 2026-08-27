// Zentraler Riot-Fetch. Einziger Zweck: der API-Key geht als Header raus,
// nicht als `?api_key=` im Query-String.
//
// Warum das ein Sicherheitsthema ist, nicht nur Stil: ein Key im Query-String
// landet in Proxy-Logs, in Referrer-Headern, in Vercel-/Riot-Zugriffslogs und
// in jeder Fehlermeldung, die die aufgerufene URL mitzitiert. Riot selbst
// dokumentiert `X-Riot-Token` als den vorgesehenen Weg; `?api_key=` ist nur
// fuer den Browser-Explorer gedacht.
//
// Regel: jeder Call gegen api.riotgames.com laeuft hierueber. Ein
// `api_key=`-Vorkommen im Repo ist ab jetzt ein Fund, kein Feature.

// 429 wird begrenzt nachgeholt. Riot schickt bei Ueberlast `Retry-After` in
// Sekunden; ohne Beachtung liefert eine Ladder-Seite mit 50 parallelen
// Namens-Calls im Zweifel halb leere Zeilen statt Namen. Zwei Versuche und
// hoechstens 5s Wartezeit, damit eine Anfrage nicht in der Funktion haengt.
const RETRY_ATTEMPTS = 2;
const RETRY_MAX_MS = 5000;

export async function riotFetch(url: string, apiKey: string, init: RequestInit = {}): Promise<Response> {
  let res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), 'X-Riot-Token': apiKey },
  });
  for (let attempt = 0; attempt < RETRY_ATTEMPTS && res.status === 429; attempt++) {
    const header = parseFloat(res.headers.get('retry-after') || '');
    const waitMs = Math.min(Number.isFinite(header) && header > 0 ? header * 1000 : 1000, RETRY_MAX_MS);
    await new Promise(r => setTimeout(r, waitMs));
    res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), 'X-Riot-Token': apiKey },
    });
  }
  return res;
}
