'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n';

interface Stream {
  id: string;
  userLogin: string;
  userName: string;
  title: string;
  viewerCount: number;
  language: string;
  thumbnailUrl: string;
}

export default function TwitchLiveStrip({ first = 8 }: { first?: number }) {
  const { t, lang } = useI18n();
  const [streams, setStreams] = useState<Stream[]>([]);

  useEffect(() => {
    fetch(`/api/twitch/tft-live?first=${first}&lang=${lang}`)
      .then(r => r.ok ? r.json() : { streams: [] })
      .then(d => setStreams(d.streams || []))
      .catch(() => {});
  }, [first, lang]);

  if (streams.length === 0) return null;
  return (
    <section className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-[#e44040] animate-pulse" />
        <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest">{t('tft.twitchLive.title')}</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {streams.map(s => (
          <a
            key={s.id}
            href={`https://twitch.tv/${s.userLogin}`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-[#141c2e] border border-[#1e2a3a] rounded overflow-hidden hover:border-[#a892ff]/40 transition-colors"
          >
            <div className="relative aspect-video bg-[#0d1526]">
              {s.thumbnailUrl ? (
                <img src={s.thumbnailUrl} alt="" className="w-full h-full object-cover" />
              ) : null}
              <span className="absolute bottom-1 left-1 bg-[#e44040] text-white text-[9px] font-medium px-1.5 py-0.5 rounded">LIVE</span>
              <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded tabular-nums">
                {s.viewerCount.toLocaleString()}
              </span>
            </div>
            <div className="p-1.5">
              <div className="text-white text-[11px] font-medium truncate">{s.userName}</div>
              <div className="text-[#7a8aa0] text-[10px] truncate">{s.title}</div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
