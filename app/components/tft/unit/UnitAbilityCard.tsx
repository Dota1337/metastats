'use client';
// Karte "Fähigkeit | Werte" der Unit-Detailseite (wie MetaTFT: Umschalter,
// Knöpfe je Form, Werte je Stern). Text und Werte aus tft-unit-info.ts; die
// Sternknöpfe heben den Wert der gewählten Stufe hervor, ohne die anderen zu
// verstecken. Fehlt die Unit in der Datei, zeigt die Karte nichts.
import { useState } from 'react';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { tftIconUrl, tftTraitDisplayName, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import {
  parseAbilityDesc, pickLang, statByStar, STAR_AD, STAR_HP,
  type AbilitySeg, type AbilityStyle, type UnitInfoFile,
} from '../../../lib/tft-unit-info';
import { starColor } from '../../../lib/tft-ui';

const STYLE_CLASS: Record<AbilityStyle, string> = {
  bright: 'text-white font-semibold',
  magic: 'text-[#7cb7ff]',
  physical: 'text-[#ff9b5a]',
  health: 'text-[#3ecf8e]',
  stat: 'text-[#e0c75a]',
  keyword: 'text-[#c39bff]',
  dim: 'text-fg-muted',
  rules: 'text-fg-muted text-[11px] italic',
};

// Symbole im Text (%i:scaleAP%): kurzes Kürzel, Name als Titel.
const ICON_SHORT: Record<string, string> = {
  scaleAP: 'AP', scaleAD: 'AD', scaleHealth: 'HP', scaleAS: 'AS', scaleDA: 'DA', scaleArmor: 'AR', scaleMR: 'MR',
};

type Tab = 'ability' | 'stats';

export default function UnitAbilityCard({ unitId, info, assets }: {
  unitId: string;
  info: UnitInfoFile | null;
  assets: TftAssetsBundle | null;
}) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<Tab>('ability');
  const [star, setStar] = useState<number | null>(null);
  const base = info?.units[unitId];
  const baseId = base?.formOf ?? unitId;
  const forms = info?.units[baseId]?.forms ?? [];
  const [form, setForm] = useState<string>(unitId);
  if (!info || !base) return null;
  const shownId = info.units[form] ? form : unitId;
  const entry = info.units[shownId]!;
  const stats = entry.stats ?? info.units[baseId]?.stats ?? null;
  const name = pickLang(entry.ability.name, lang);
  const lines = parseAbilityDesc(pickLang(entry.ability.desc, lang));
  const statLabel = (k: string) => {
    const key = `tft.stat.${k}` as TranslationKey;
    const v = t(key);
    return v && v !== key ? v : k;
  };

  return (
    <div className="bg-surface-base border border-border-subtle rounded-lg overflow-hidden">
      <div role="tablist" className="grid grid-cols-2 border-b border-border-subtle">
        {(['ability', 'stats'] as Tab[]).map(k => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`py-2.5 text-[13px] font-medium transition-colors border-b-2 -mb-px ${
              tab === k ? 'text-white border-accent' : 'text-fg-muted border-transparent hover:text-fg-secondary'
            }`}
          >
            {t(k === 'ability' ? 'tft.unit.ability' : 'tft.unit.stats')}
          </button>
        ))}
      </div>

      <div className="p-4">
        <div className="flex items-center justify-center gap-1.5 mb-3" role="group" aria-label={t('tft.stars')}>
          {[1, 2, 3].map(s => (
            <button
              key={s}
              type="button"
              aria-pressed={star === s}
              onClick={() => setStar(star === s ? null : s)}
              className={`px-2.5 py-1 rounded border text-[12px] leading-none transition-colors ${
                star === s ? 'border-accent bg-accent-a10' : 'border-border-subtle hover:border-accent-a40'
              }`}
              style={{ color: starColor(s) }}
            >
              {'★'.repeat(s)}
            </button>
          ))}
        </div>

        {tab === 'ability' && (
          <>
            {forms.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1.5 mb-3">
                {[baseId, ...forms].map(id => {
                  const e = info.units[id];
                  const label = id === baseId ? t('tft.unit.formDefault') : (pickLang(e?.form, lang) ?? id);
                  const trait = id === baseId ? null : (assets?.champions[id]?.traits || []).find(tr => !/UniqueTrait/i.test(tr)) ?? null;
                  const icon = trait ? tftIconUrl(assets, assets?.traits[trait]?.icon) : null;
                  const active = shownId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setForm(id)}
                      title={trait ? (tftTraitDisplayName(assets, trait) || label) : label}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium transition-colors ${
                        active ? 'border-accent bg-accent text-white' : 'border-border-subtle text-fg-secondary hover:border-accent-a40 hover:text-white'
                      }`}
                    >
                      {icon && <img src={icon} alt="" className="w-3.5 h-3.5" />}
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-white text-[14px] font-semibold flex-1 min-w-0 truncate">{name}</span>
              {stats?.mana != null && (
                <span className="text-[12px] tabular-nums text-[#7cb7ff] whitespace-nowrap" title={statLabel('scaleMana')}>
                  {stats.initialMana ?? 0}<span className="text-fg-muted">/{stats.mana}</span>
                </span>
              )}
            </div>
            <div className="text-[13px] leading-relaxed text-fg-secondary space-y-0.5">
              {lines.map((l, i) => (l.length === 0
                ? <div key={i} className="h-2" />
                : <p key={i}>{l.map((s, j) => <Seg key={j} seg={s} star={star} />)}</p>))}
            </div>
          </>
        )}

        {tab === 'stats' && stats && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[12px]">
            <StatCell label={statLabel('scaleHealth')} values={statByStar(stats.hp, STAR_HP)} star={star} />
            <StatCell label={statLabel('scaleMana')} text={stats.mana != null ? `${stats.initialMana ?? 0}/${stats.mana}` : null} />
            <StatCell label={statLabel('scaleAD')} values={statByStar(stats.damage, STAR_AD)} star={star} />
            <StatCell label={statLabel('scaleAS')} text={stats.attackSpeed != null ? stats.attackSpeed.toFixed(2).replace(/0$/, '') : null} />
            <StatCell label={statLabel('scaleArmor')} text={stats.armor != null ? String(stats.armor) : null} />
            <StatCell label={statLabel('scaleMR')} text={stats.magicResist != null ? String(stats.magicResist) : null} />
            <StatCell label={statLabel('scaleCrit')} text={stats.critChance != null ? `${Math.round(stats.critChance * 100)}%` : null} />
            <StatCell label={statLabel('scaleCritMult')} text={stats.critMultiplier != null ? `${Math.round(stats.critMultiplier * 100)}%` : null} />
            <StatCell label={t('tft.unit.range')} text={stats.range != null ? String(stats.range) : null} />
          </dl>
        )}
      </div>
    </div>
  );
}

function Seg({ seg, star }: { seg: AbilitySeg; star: number | null }) {
  const cls = seg.style ? STYLE_CLASS[seg.style] : '';
  if (seg.k === 'text') return <span className={cls}>{seg.text}</span>;
  if (seg.k === 'icon') {
    return (
      <span className="inline-block align-[1px] mx-0.5 px-1 rounded bg-surface-overlay text-[9px] font-semibold text-fg-secondary leading-[14px]">
        {ICON_SHORT[seg.icon] ?? seg.icon.replace(/^scale/, '')}
      </span>
    );
  }
  return <StarValues values={seg.values} suffix={seg.suffix} star={star} className={cls || 'text-white'} />;
}

// "375/565/6500" mit hervorgehobener Stufe; ohne Wahl alle gleich hell.
function StarValues({ values, suffix = '', star, className = '' }: {
  values: Array<string | number>; suffix?: string; star: number | null; className?: string;
}) {
  return (
    <span className={`tabular-nums ${className}`}>
      {values.map((v, i) => (
        <span key={i}>
          {i > 0 && <span className="text-fg-faint">/</span>}
          <span className={star == null ? 'font-semibold' : i + 1 === star ? 'font-bold underline decoration-2 underline-offset-2' : 'opacity-45'}>
            {typeof v === 'number' ? v.toLocaleString('de-DE') : v}
          </span>
        </span>
      ))}
      {suffix}
    </span>
  );
}

function StatCell({ label, values, text, star = null }: {
  label: string; values?: number[] | null; text?: string | null; star?: number | null;
}) {
  if (!values && !text) return null;
  return (
    <div>
      <dt className="text-fg-muted text-[11px]">{label}</dt>
      <dd className="text-white text-[13px] font-medium mt-0.5">
        {values ? <StarValues values={values} star={star} /> : <span className="tabular-nums">{text}</span>}
      </dd>
    </div>
  );
}
