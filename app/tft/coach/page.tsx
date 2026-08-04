'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams, notFound } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';
import { TFT_COACH_ENABLED } from '../../lib/feature-flags';

// AI-Coach (Sprint 7+). Streaming chat with optional player-context
// injection — pass ?puuid=...&region=... to get advice grounded in the
// caller's last 60 matches. Falls back to a generic-advice mode when no
// puuid is passed or ANTHROPIC_API_KEY isn't set on the server.

interface Message { role: 'user' | 'assistant'; content: string }

// Guard im Wrapper, damit die Hooks in CoachChat unbedingt bleiben
// (Rules of Hooks). Bei deaktiviertem Feature ist die Route per Deep-Link
// nicht mehr erreichbar; der Nav-Link ist ohnehin ausgeblendet.
export default function TftCoachPage() {
  if (!TFT_COACH_ENABLED) notFound();
  return <CoachChat />;
}

function CoachChat() {
  const { t, lang } = useI18n();
  const search = useSearchParams();
  const puuid = search.get('puuid');
  const region = search.get('region');
  const set = search.get('set') ? Number(search.get('set')) : null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    setErr(null);
    const userMsg: Message = { role: 'user', content: trimmed };
    const newHistory = [...messages, userMsg];
    setMessages([...newHistory, { role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);

    try {
      const res = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': lang },
        body: JSON.stringify({ messages: newHistory, puuid, region, set }),
      });
      if (res.status === 503) {
        setErr(t('tft.coach.unavailable'));
        setMessages(m => m.slice(0, -1));
        setStreaming(false);
        return;
      }
      if (!res.ok || !res.body) {
        setErr(`HTTP ${res.status}`);
        setMessages(m => m.slice(0, -1));
        setStreaming(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages(m => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: acc };
          return copy;
        });
      }
    } catch (e: any) {
      setErr(e.message || 'network_error');
      setMessages(m => m.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  const suggestions = [
    t('tft.coach.q1'),
    t('tft.coach.q2'),
    t('tft.coach.q3'),
    t('tft.coach.q4'),
  ];

  return (
    <main className="min-h-screen bg-[#0e1525] flex flex-col">
      <Nav active={'coach' as any} />
      <div className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col">
        <div className="mb-4">
          <h1 className="text-white text-2xl font-medium">{t('tft.coach.title')}</h1>
          <p className="text-[#a0b0c5] text-sm">
            {puuid ? t('tft.coach.subtitleWithProfile') : t('tft.coach.subtitle')}
          </p>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4 overflow-y-auto mb-3"
          style={{ minHeight: 360, maxHeight: 'calc(100vh - 320px)' }}
        >
          {messages.length === 0 && (
            <div className="text-center text-[#7a8aa0] py-12">
              <div className="text-[#a892ff] text-3xl mb-2">⚡</div>
              <div className="text-sm mb-4">{t('tft.coach.greet')}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md mx-auto">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(s)}
                    className="text-left px-3 py-2 bg-[#141c2e] border border-[#1e2a3a] rounded text-[12px] text-[#a0b0c5] hover:border-[#7B61FF]/40 hover:text-white"
                  >{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`mb-3 ${m.role === 'user' ? 'text-right' : ''}`}>
              <div
                className={`inline-block max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-[#7B61FF] text-white'
                    : 'bg-[#141c2e] border border-[#1e2a3a] text-[#e0e6f0]'
                }`}
              >
                {m.content || (m.role === 'assistant' && streaming ? '…' : '')}
              </div>
            </div>
          ))}
          {err && <div className="text-[#e44040] text-xs mt-2">{err}</div>}
        </div>

        <form onSubmit={send} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={t('tft.coach.placeholder')}
            disabled={streaming}
            className="flex-1 bg-[#141c2e] border border-[#1e2a3a] rounded px-3 py-2 text-sm text-white outline-none focus:border-[#7B61FF]/60 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="px-5 py-2 bg-[#7B61FF] text-white rounded text-sm font-medium hover:bg-[#9981FF] disabled:opacity-30 disabled:cursor-not-allowed"
          >{streaming ? '…' : t('tft.coach.send')}</button>
        </form>
      </div>
      <Footer />
    </main>
  );
}
