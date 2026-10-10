// Warteschlange des Explorer-Dienstes (scripts/explorer-duckdb-server.mjs),
// aus dem Dienst hierher gezogen, damit ein Test sie pruefen kann — der Dienst
// selbst startet beim Import.
//
// max laufend, bis zu maxQueue wartend, danach 503 ("busy").
// wait: das Vorwaermen stellt sich immer an, statt abgewiesen zu werden.
// giveUpAt (ms seit 1970): wer bis dahin keinen Platz hat, verlaesst die
// Schlange mit 504. Vorher pruefte ein Wartender seine Frist erst nach der
// Platzvergabe und hielt bis dahin einen Wartenplatz, auch wenn refresh-api
// laengst aufgegeben hatte (Paket 6, Option 2).
export function makeLane(max, maxQueue) {
  const lane = { running: 0, queue: [] };
  lane.acquire = ({ wait = false, giveUpAt = null } = {}) => {
    if (lane.running < max) { lane.running++; return Promise.resolve(); }
    if (!wait && lane.queue.length >= maxQueue) {
      const e = new Error('busy'); e.status = 503; throw e;
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, timer: null };
      if (giveUpAt != null) {
        entry.timer = setTimeout(() => {
          const i = lane.queue.indexOf(entry);
          if (i < 0) return;
          lane.queue.splice(i, 1);
          const e = new Error('timeout'); e.status = 504; e.queued = true; reject(e);
        }, Math.max(0, giveUpAt - Date.now()));
      }
      lane.queue.push(entry);
    });
  };
  lane.release = () => {
    const next = lane.queue.shift();
    if (next) { clearTimeout(next.timer); next.resolve(); } else lane.running--;
  };
  return lane;
}
