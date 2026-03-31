'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';

interface ChampionSpell {
  id: string;
  name: string;
  description: string;
  image: { full: string };
}

interface ChampionPassive {
  name: string;
  description: string;
  image: { full: string };
}

interface ChampionStats {
  hp: number;
  hpperlevel: number;
  mp: number;
  mpperlevel: number;
  armor: number;
  armorperlevel: number;
  spellblock: number;
  spellblockperlevel: number;
  attackdamage: number;
  attackdamageperlevel: number;
  attackspeed: number;
  attackspeedperlevel: number;
  movespeed: number;
  attackrange: number;
}

interface ChampionSkin {
  id: string;
  num: number;
  name: string;
  chromas: boolean;
}

interface ChampionData {
  id: string;
  key: string;
  name: string;
  title: string;
  tags: string[];
  lore: string;
  allytips: string[];
  enemytips: string[];
  stats: ChampionStats;
  spells: ChampionSpell[];
  passive: ChampionPassive;
  skins: ChampionSkin[];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

const TAG_COLORS: Record<string, string> = {
  Fighter: '#c89b3c',
  Tank: '#4a90d9',
  Mage: '#9b59b6',
  Assassin: '#e74c3c',
  Marksman: '#e67e22',
  Support: '#2ecc71',
};

const SPELL_KEYS = ['Q', 'W', 'E', 'R'];

export default function ChampionDetailPage() {
  const { id } = useParams();
  const [champion, setChampion] = useState<ChampionData | null>(null);
  const [version, setVersion] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedSkin, setSelectedSkin] = useState(0);
  const { t } = useI18n();

  useEffect(() => {
    if (!id) return;
    loadChampion(id as string);
  }, [id]);

  const loadChampion = async (championId: string) => {
    setLoading(true);
    setError('');
    try {
      const versionRes = await fetch('/api/version');
      const versionData = await versionRes.json();
      const ver = versionData.version;
      setVersion(ver);

      const res = await fetch(
        `https://ddragon.leagueoflegends.com/cdn/${ver}/data/de_DE/champion/${championId}.json`
      );
      if (!res.ok) throw new Error('Champion nicht gefunden');
      const data = await res.json();
      const champData = data.data[championId];
      if (!champData) throw new Error('Champion nicht gefunden');
      setChampion(champData);
    } catch (e: any) {
      setError(e.message || 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  };

  const statItems = champion
    ? [
        { label: 'Leben', value: champion.stats.hp, growth: champion.stats.hpperlevel },
        { label: 'Mana', value: champion.stats.mp, growth: champion.stats.mpperlevel },
        { label: 'Angriffsschaden', value: champion.stats.attackdamage, growth: champion.stats.attackdamageperlevel },
        { label: 'Ruestung', value: champion.stats.armor, growth: champion.stats.armorperlevel },
        { label: 'Magieresistenz', value: champion.stats.spellblock, growth: champion.stats.spellblockperlevel },
        { label: 'Angriffsgeschw.', value: champion.stats.attackspeed, growth: champion.stats.attackspeedperlevel, isPercent: true },
        { label: 'Laufgeschw.', value: champion.stats.movespeed, growth: 0 },
        { label: 'Reichweite', value: champion.stats.attackrange, growth: 0 },
      ]
    : [];

  return (
    <main className="min-h-screen bg-[#0e1525]">
      {/* Navigation */}
      <Nav active="champions" />

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-40">
          <div className="text-[#8a9bb0] text-lg">{t('champDetail.loading')}</div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <div className="text-red-400 text-xl mb-4">{error}</div>
          <a
            href="/champions"
            className="inline-block px-6 py-2 bg-[#1e2a3a] text-[#8a9bb0] rounded hover:text-white transition-colors"
          >
            Zurueck zur Champion-Uebersicht
          </a>
        </div>
      )}

      {/* Champion Content */}
      {champion && !loading && (
        <>
          {/* Hero Section */}
          <div className="relative overflow-hidden">
            <div
              className="absolute inset-0 bg-cover bg-center bg-no-repeat"
              style={{
                backgroundImage: `url(https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${champion.id}_0.jpg)`,
                filter: 'brightness(0.25) blur(2px)',
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0e1525]" />
            <div className="relative max-w-4xl mx-auto px-6 py-16 flex items-center gap-6">
              <img
                src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champion.id}.png`}
                alt={champion.name}
                className="w-24 h-24 rounded-lg border-2 border-[#c89b3c] shadow-lg"
              />
              <div>
                <a
                  href="/champions"
                  className="text-[#8a9bb0] text-xs hover:text-white transition-colors mb-2 inline-block"
                >
                  &larr; {t('champDetail.back')}
                </a>
                <h1 className="text-white text-3xl font-bold">{champion.name}</h1>
                <p className="text-[#c89b3c] text-sm mt-1">{champion.title}</p>
                <div className="flex gap-2 mt-3">
                  {champion.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: `${TAG_COLORS[tag] || '#c89b3c'}20`,
                        color: TAG_COLORS[tag] || '#c89b3c',
                        border: `1px solid ${TAG_COLORS[tag] || '#c89b3c'}40`,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="max-w-4xl mx-auto px-6 pb-12">
            {/* Stats Section */}
            <section className="mb-8">
              <h2 className="text-white text-lg font-semibold mb-4">{t('champDetail.baseStats')}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {statItems.map((stat) => (
                  <div
                    key={stat.label}
                    className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3"
                  >
                    <div className="text-[#8a9bb0] text-xs mb-1">{stat.label}</div>
                    <div className="text-white text-lg font-medium">
                      {stat.isPercent
                        ? stat.value.toFixed(3)
                        : Math.round(stat.value)}
                    </div>
                    {stat.growth > 0 && (
                      <div className="text-[#c89b3c] text-xs mt-0.5">
                        +{stat.isPercent ? `${stat.growth}%` : stat.growth} / {t('champDetail.perLevel')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Abilities Section */}
            <section className="mb-8">
              <h2 className="text-white text-lg font-semibold mb-4">{t('champDetail.abilities')}</h2>
              <div className="space-y-3">
                {/* Passive */}
                <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 flex gap-4">
                  <div className="flex-shrink-0 flex flex-col items-center gap-1">
                    <span className="text-xs font-bold text-[#c89b3c] bg-[#c89b3c20] px-2 py-0.5 rounded">
                      P
                    </span>
                    <img
                      src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/passive/${champion.passive.image.full}`}
                      alt={champion.passive.name}
                      className="w-10 h-10 rounded border border-[#1e2a3a]"
                    />
                  </div>
                  <div>
                    <div className="text-white text-sm font-medium mb-1">
                      {champion.passive.name}
                    </div>
                    <div className="text-[#8a9bb0] text-sm leading-relaxed">
                      {stripHtml(champion.passive.description)}
                    </div>
                  </div>
                </div>

                {/* Q/W/E/R */}
                {champion.spells.map((spell, i) => (
                  <div
                    key={spell.id}
                    className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 flex gap-4"
                  >
                    <div className="flex-shrink-0 flex flex-col items-center gap-1">
                      <span className="text-xs font-bold text-[#c89b3c] bg-[#c89b3c20] px-2 py-0.5 rounded">
                        {SPELL_KEYS[i]}
                      </span>
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${spell.image.full}`}
                        alt={spell.name}
                        className="w-10 h-10 rounded border border-[#1e2a3a]"
                      />
                    </div>
                    <div>
                      <div className="text-white text-sm font-medium mb-1">
                        {spell.name}
                      </div>
                      <div className="text-[#8a9bb0] text-sm leading-relaxed">
                        {stripHtml(spell.description)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Tips Section */}
            {(champion.allytips.length > 0 || champion.enemytips.length > 0) && (
              <section className="mb-8">
                <h2 className="text-white text-lg font-semibold mb-4">{t('champDetail.tips')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {champion.allytips.length > 0 && (
                    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                      <h3 className="text-green-400 text-sm font-medium mb-3">
                        {t('champDetail.allyTips')}
                      </h3>
                      <ul className="space-y-2">
                        {champion.allytips.map((tip, i) => (
                          <li key={i} className="text-[#8a9bb0] text-sm flex gap-2">
                            <span className="text-green-400/60 flex-shrink-0">&#x2022;</span>
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {champion.enemytips.length > 0 && (
                    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                      <h3 className="text-red-400 text-sm font-medium mb-3">
                        {t('champDetail.enemyTips')}
                      </h3>
                      <ul className="space-y-2">
                        {champion.enemytips.map((tip, i) => (
                          <li key={i} className="text-[#8a9bb0] text-sm flex gap-2">
                            <span className="text-red-400/60 flex-shrink-0">&#x2022;</span>
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Skins Gallery */}
            {champion.skins && champion.skins.length > 1 && (
              <section className="mb-8">
                <h2 className="text-white text-lg font-semibold mb-4">Skins ({champion.skins.length - 1})</h2>
                <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
                  {/* Selected skin splash */}
                  <div className="relative aspect-[16/7] overflow-hidden">
                    <img
                      src={`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${champion.id}_${champion.skins[selectedSkin]?.num || 0}.jpg`}
                      alt={champion.skins[selectedSkin]?.name || champion.name}
                      className="w-full h-full object-cover object-top transition-opacity duration-300"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0d1526] via-transparent to-transparent" />
                    <div className="absolute bottom-4 left-4">
                      <div className="text-white text-lg font-medium">
                        {champion.skins[selectedSkin]?.name === 'default'
                          ? champion.name
                          : champion.skins[selectedSkin]?.name}
                      </div>
                      {champion.skins[selectedSkin]?.chromas && (
                        <span className="text-[#c89b3c] text-xs">Chromas verfuegbar</span>
                      )}
                    </div>
                  </div>
                  {/* Skin thumbnails */}
                  <div className="flex gap-1 p-3 overflow-x-auto">
                    {champion.skins.map((skin, i) => (
                      <button
                        key={skin.id}
                        onClick={() => setSelectedSkin(i)}
                        className={`flex-shrink-0 w-16 h-16 rounded overflow-hidden border-2 transition-all ${
                          selectedSkin === i
                            ? 'border-[#c89b3c] ring-1 ring-[#c89b3c]/50'
                            : 'border-transparent opacity-60 hover:opacity-100'
                        }`}
                      >
                        <img
                          src={`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${champion.id}_${skin.num}.jpg`}
                          alt={skin.name}
                          className="w-full h-full object-cover object-top"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Lore Section */}
            <section className="mb-8">
              <h2 className="text-white text-lg font-semibold mb-4">{t('champDetail.lore')}</h2>
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-5">
                <p className="text-[#8a9bb0] text-sm leading-relaxed">
                  {champion.lore}
                </p>
              </div>
            </section>

            {/* Footer */}
            <Footer />
          </div>
        </>
      )}
    </main>
  );
}
