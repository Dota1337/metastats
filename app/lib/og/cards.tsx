// Die drei dynamischen Vorschaubilder. Fast ohne Woerter — Zahlen, Raenge und
// Spielbegriffe lesen sich in allen sechs Sprachen gleich, deshalb braucht das
// Bild keine Sprachwahl (die Vorschau wird ohnehin ohne Sprach-Cookie geholt).
import type { ReactElement, ReactNode } from 'react';
import { ImageResponse } from 'next/og';
import { regionLabel } from '../regions';
import { CURRENT_SET } from '../current-set';
import { OG_SIZE, OG_CACHE_HEADERS, ACCENT_LOL, ACCENT_TFT, OgFrame, Pill, Brand } from './frame';
import type { CompOg, TftPlayerOg, LolPlayerOg } from './data';

const COST_COLORS: Record<number, string> = {
  1: '#9aa4af', 2: '#11b288', 3: '#207ac7', 4: '#c440da', 5: '#ffb93b',
};

function groupThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function pct(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}

function render(node: ReactElement): ImageResponse {
  return new ImageResponse(node, { ...OG_SIZE, headers: OG_CACHE_HEADERS });
}

function Headline({ children, size }: { children: ReactNode; size: number }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', textAlign: 'center', maxWidth: 1080, fontSize: size, fontWeight: 700, color: 'white', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
      {children}
    </div>
  );
}

function headlineSize(text: string, max: number): number {
  const len = [...text].length;
  if (len <= 16) return max;
  if (len <= 24) return Math.round(max * 0.8);
  if (len <= 34) return Math.round(max * 0.65);
  return Math.round(max * 0.5);
}

function rankLabel(tier: string | null, division: string | null): string | null {
  if (!tier) return null;
  const t = tier.toUpperCase();
  // Ab Master gibt es keine Division.
  return ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(t) || !division ? t : `${t} ${division}`;
}

// ---------- Comp ----------

export function compImage(data: CompOg | null, fallbackName: string): ImageResponse {
  const name = data?.name || fallbackName;
  const units = data?.units || [];
  const s = data?.stats;
  return render(
    <OgFrame accent={ACCENT_TFT}>
      <Brand accent={ACCENT_TFT} label={`TFT · SET ${CURRENT_SET}`} />
      <Headline size={headlineSize(name, 76)}>{name}</Headline>
      {units.length > 0 && (
        <div style={{ display: 'flex', gap: 14, marginTop: 40 }}>
          {units.map(u => (
            <div key={u.id} style={{ display: 'flex', width: 100, height: 100, borderRadius: 12, border: `4px solid ${COST_COLORS[u.cost] || '#4a5568'}`, overflow: 'hidden', background: '#141a2b' }}>
              {u.tile && <img src={u.tile} width={92} height={92} style={{ objectFit: 'cover' }} />}
            </div>
          ))}
        </div>
      )}
      {s && (
        <div style={{ display: 'flex', gap: 16, marginTop: 44 }}>
          <Pill accent={ACCENT_TFT} size={34}>Ø {s.avgPlacement.toFixed(2)}</Pill>
          <Pill accent={ACCENT_TFT} size={34}>Top 4 · {pct(s.top4Rate)}</Pill>
          <Pill accent={ACCENT_TFT} size={34}>Top 1 · {pct(s.top1Rate)}</Pill>
          <Pill accent={ACCENT_TFT} size={34}>n = {groupThousands(s.games)}</Pill>
        </div>
      )}
    </OgFrame>,
  );
}

// ---------- Spieler (TFT und LoL teilen das Layout) ----------

function PlayerCard({ accent, label, name, tag, icon, pills }: {
  accent: string; label: string; name: string; tag: string; icon: string | null; pills: string[];
}) {
  return (
    <OgFrame accent={accent}>
      <Brand accent={accent} label={label} />
      {icon && (
        <img src={icon} width={150} height={150} style={{ borderRadius: 75, border: `4px solid ${accent}`, marginBottom: 32 }} />
      )}
      <Headline size={headlineSize(name + tag, 104)}>
        <span>{name}</span>
        {tag && <span style={{ color: accent, marginLeft: 8 }}>#{tag}</span>}
      </Headline>
      {pills.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginTop: 48 }}>
          {pills.map(p => <Pill key={p} accent={accent} size={36}>{p}</Pill>)}
        </div>
      )}
    </OgFrame>
  );
}

export function tftPlayerImage(name: string, tag: string, d: TftPlayerOg | null): ImageResponse {
  const pills: string[] = [];
  const rank = rankLabel(d?.tier ?? null, d?.division ?? null);
  if (rank) pills.push(d?.lp != null ? `${rank} · ${d.lp} LP` : rank);
  if (d?.region) pills.push(regionLabel(d.region));
  return render(<PlayerCard accent={ACCENT_TFT} label="TFT" name={name} tag={tag} icon={null} pills={pills} />);
}

export function lolPlayerImage(name: string, tag: string, d: LolPlayerOg | null): ImageResponse {
  const pills: string[] = [];
  const rank = rankLabel(d?.tier ?? null, d?.rank ?? null);
  if (rank) pills.push(d?.lp != null ? `${rank} · ${d.lp} LP` : rank);
  // Marktwert im selben Format wie auf der Seite (app/lib/marketvalue.ts:479).
  if (d?.marketValue) pills.push('$' + groupThousands(d.marketValue));
  if (d?.region) pills.push(regionLabel(d.region));
  return render(<PlayerCard accent={ACCENT_LOL} label="LEAGUE OF LEGENDS" name={name} tag={tag} icon={d?.icon ?? null} pills={pills} />);
}
