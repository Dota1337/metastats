// Warteschlange des Explorer-Dienstes (scripts/explorer-duckdb-server.mjs),
// aus dem Dienst hierher gezogen, damit ein Test sie pruefen kann — der Dienst
// selbst startet beim Import.
//
// max laufend, bis zu maxQueue wartend, danach 503 ("busy").
// wait: das Vorwaermen stellt sich immer an, statt abgewiesen zu werden.
// giveUpAt (ms seit 1970): wer bis dahin keinen Platz hat, verlaesst die
// Schlange mit 503 ("busy", queued) — die Seite zeigt dann „Server
// ausgelastet", nicht „Abfrage zu aufwendig": gerechnet wurde nichts.
// Vorher pruefte ein Wartender seine Frist erst nach der Platzvergabe und
// hielt bis dahin einen Wartenplatz (Paket 6, Option 2).
// Reihenfolge: frueheste Aufgabe zuerst, bei Gleichstand nach Ankunft,
// Vorwaermen (ohne giveUpAt) zuletzt. Seit kurze Abfragen bis 32 s warten
// duerfen, kaeme eine lange (Aufgabe nach 15 s) hinter spaeter eingetroffenen
// kurzen sonst nie dran (logic-flow-critic, 10.10.).
export function makeLane(max, maxQueue) {
  const lane = { running: 0, queue: [] };
  lane.acquire = ({ wait = false, giveUpAt = null } = {}) => {
    if (lane.running < max) { lane.running++; return Promise.resolve(); }
    if (!wait && lane.queue.length >= maxQueue) {
      const e = new Error('busy'); e.status = 503; throw e;
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, timer: null, at: giveUpAt ?? Infinity };
      if (giveUpAt != null) {
        entry.timer = setTimeout(() => {
          const i = lane.queue.indexOf(entry);
          if (i < 0) return;
          lane.queue.splice(i, 1);
          const e = new Error('busy'); e.status = 503; e.queued = true; reject(e);
        }, Math.max(0, giveUpAt - Date.now()));
      }
      const i = lane.queue.findIndex(x => x.at > entry.at);
      if (i < 0) lane.queue.push(entry); else lane.queue.splice(i, 0, entry);
    });
  };
  lane.release = () => {
    const next = lane.queue.shift();
    if (next) { clearTimeout(next.timer); next.resolve(); } else lane.running--;
  };
  return lane;
}
