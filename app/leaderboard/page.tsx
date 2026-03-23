'use client';
import { useState, useEffect } from 'react';

export default function Leaderboard() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/leaderboard')
      .then(res => res.json())
      .then(data => {
        if (data.error) setError(data.error);
        else setEntries(data.entries || []);
      })
      .catch(() => setError('Fehler beim Laden'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-[#080c18]">
      <nav className="bg-[#0a0e1a] border-b border-[#1e2a3a] px-6 py-3 flex items-center justify-between">
        <a href="/" className="text-[#c89b3c] text-lg font-medium">meta<span className="text-white">stats</span>.gg</a>
        <div className="flex gap-6">
          <a href="/" className="text-[#8a9bb0] text-sm hover:text-white">Spielersuche</a>
          <a href="/leaderboard" className="text-white text-sm">Rangliste</a>
          <a href="#" className="text-[#8a9bb0] text-sm hover:text-white">Champions</a>
        </div>
      </nav>
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-white text-2xl font-medium">Rangliste</h1>
          <span className="bg-[#c89b3c] text-[#0a0e1a] text-xs font-medium px-2 py-1 rounded">CHALLENGER · EUW</span>
        </div>
        {loading && <div className="text-center text-[#8a9bb0] mt-20">Lade Rangliste...</div>}
        {error && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center">
            <div className="text-[#8a9bb0] text-sm mb-2">Ranglisten-Daten nicht verfügbar</div>
            <div className="text-[#4a5a70] text-xs">Verfügbar sobald der Production Key aktiv ist</div>
          </div>
        )}
        {entries.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            <div className="grid grid-cols-12 gap-4 px-4 py-2 border-b border-[#1e2a3a]">
              <div className="col-span-1 text-[#8a9bb0] text-xs">#</div>
              <div className="col-span-5 text-[#8a9bb0] text-xs">Spieler</div>
              <div className="col-span-2 text-[#8a9bb0] text-xs text-right">LP</div>
              <div className="col-span-2 text-[#8a9bb0] text-xs text-right">Winrate</div>
              <div className="col-span-2 text-[#8a9bb0] text-xs text-right">Spiele</div>
            </div>
            {entries.map((entry) => (
              <a key={entry.rank} href={'/player/' + entry.slug} className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-[#1e2a3a] hover:bg-[#141c2e] transition-colors">
                <div className="col-span-1 flex items-center">
                  <span className={entry.rank === 1 ? 'text-yellow-400 text-sm font-medium' : entry.rank === 2 ? 'text-gray-400 text-sm font-medium' : entry.rank === 3 ? 'text-amber-600 text-sm font-medium' : 'text-[#8a9bb0] text-sm'}>{entry.rank}</span>
                </div>
                <div className="col-span-5 flex items-center">
                  <span className="text-white text-sm">{entry.summonerName}</span>
                </div>
                <div className="col-span-2 flex items-center justify-end">
                  <span className="text-[#c89b3c] text-sm font-medium">{entry.leaguePoints} LP</span>
                </div>
                <div className="col-span-2 flex items-center justify-end">
                  <span className={entry.winrate >= 55 ? 'text-green-400 text-sm font-medium' : entry.winrate >= 50 ? 'text-white text-sm font-medium' : 'text-red-400 text-sm font-medium'}>{entry.winrate}%</span>
                </div>
                <div className="col-span-2 flex items-center justify-end">
                  <span className="text-[#8a9bb0] text-sm">{entry.wins + entry.losses}</span>
                </div>
              </a>
            ))}
          </div>
        )}
        <div className="text-center text-[#4a5a70] text-xs mt-8 pt-6 border-t border-[#1e2a3a]">
          metastats.gg · Nicht offiziell mit Riot Games verbunden · Datenschutz · Impressum
        </div>
      </div>
    </main>
  );
}