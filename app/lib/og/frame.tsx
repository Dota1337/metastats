// Gemeinsamer Rahmen fuer alle Vorschaubilder (Link-Vorschau in Discord,
// WhatsApp, X ...). Die drei festen Bilder (Startseite, /tft, Marktwerte) und
// die drei dynamischen (Comp, TFT-Spieler, LoL-Spieler) teilen Hintergrund,
// Leisten und Masse — vorher stand derselbe Block dreimal kopiert im Repo.
//
// Bewusst ohne Server-Importe: die festen Bilder laufen auf der Edge.
import type { ReactNode } from 'react';

export const OG_SIZE = { width: 1200, height: 630 };

export const ACCENT_LOL = '#c89b3c';
export const ACCENT_TFT = '#7B61FF';

// ImageResponse setzt sonst `max-age=0, must-revalidate` (next/dist/server/og/
// image-response.js:58) — jeder Abruf rendert neu. Ein Tag am CDN, danach eine
// Woche alt ausliefern und im Hintergrund erneuern: Vorschaubilder muessen
// nicht tagesaktuell sein, aber schnell, sonst zeigt der Dienst gar keins.
export const OG_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
};

/** "#7B61FF" → "123, 97, 255" fuer rgba(). */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export function accentAlpha(accent: string, alpha: number): string {
  return `rgba(${rgb(accent)}, ${alpha})`;
}

/** Hintergrund + Leisten oben/unten. Inhalt wird zentriert gestapelt. */
export function OgFrame({ accent, children }: { accent: string; children: ReactNode }) {
  const bar = {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    height: '6px',
    background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
  };
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #0a0e1a 0%, #0e1525 50%, #1a1f35 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px',
        position: 'relative',
      }}
    >
      <div style={{ ...bar, top: 0 }} />
      <div style={{ ...bar, bottom: 0 }} />
      {children}
    </div>
  );
}

export function Pill({ accent, children, size = 24 }: { accent: string; children: ReactNode; size?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 20px',
        border: `1px solid ${accentAlpha(accent, 0.4)}`,
        borderRadius: 8,
        color: accent,
        background: accentAlpha(accent, 0.08),
        fontSize: size,
      }}
    >
      {children}
    </div>
  );
}

/** Die drei festen Bilder: grosser Titel, Unterzeile, Reihe von Schlagworten. */
export function StaticCard({ accent, title, subtitle, pills }: {
  accent: string; title: ReactNode; subtitle: string; pills: string[];
}) {
  return (
    <OgFrame accent={accent}>
      <div style={{ fontSize: 128, fontWeight: 700, color: 'white', letterSpacing: '-0.02em', display: 'flex' }}>
        {title}
      </div>
      <div style={{ fontSize: 32, color: '#a0b0c5', marginTop: 20, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        {subtitle}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 48, fontSize: 24 }}>
        {pills.map(label => <Pill key={label} accent={accent}>{label}</Pill>)}
      </div>
    </OgFrame>
  );
}

/** Kleine Marke oben links in den dynamischen Bildern. */
export function Brand({ accent, label }: { accent: string; label: string }) {
  return (
    <div style={{ position: 'absolute', top: 40, left: 60, display: 'flex', alignItems: 'center', gap: 16, fontSize: 30, fontWeight: 700, color: 'white' }}>
      <div style={{ display: 'flex' }}>meta<span style={{ color: accent }}>stats</span>.gg</div>
      <div style={{ display: 'flex', fontSize: 22, color: '#a0b0c5', letterSpacing: '0.08em' }}>{label}</div>
    </div>
  );
}

/** Wartet hoechstens `ms`; danach `null`. Der Fehlerfall ist ebenfalls `null`. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p.catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
