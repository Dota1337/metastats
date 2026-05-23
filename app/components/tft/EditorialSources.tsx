'use client';
import { useI18n } from '../../lib/i18n';
import editorial from '../../../data/tft-editorial-tiers.json';

interface Source { id: string; name: string; by: string; url: string; tagline: string }

export default function EditorialSources() {
  const { t } = useI18n();
  const sources = (editorial as any).sources as Source[];
  if (!sources || sources.length === 0) return null;
  return (
    <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
      <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.editorialTiers')}</h2>
      <p className="text-[#7a8aa0] text-xs mb-3">{t('tft.comp.editorialTiers.intro')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {sources.map(s => (
          <a
            key={s.id}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3 hover:border-[#a892ff]/40 transition-colors"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-white text-sm font-medium">{s.name}</span>
              <span className="text-[#a892ff] text-[10px] tracking-widest">↗</span>
            </div>
            <div className="text-[#a0b0c5] text-[11px]">{s.by}</div>
            <div className="text-[#7a8aa0] text-[10px] mt-1">{s.tagline}</div>
          </a>
        ))}
      </div>
    </section>
  );
}
