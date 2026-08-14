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

export function riotFetch(url: string, apiKey: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), 'X-Riot-Token': apiKey },
  });
}
