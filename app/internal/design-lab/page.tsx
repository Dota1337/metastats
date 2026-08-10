'use client';

// Design-Werkstatt — interne Vorschau, nie im Menue verlinkt.
//
// Zweck: Gesamtdesign-Entwuerfe nebeneinander sehen, bevor irgendetwas live
// geht. Die Seite liegt unter /internal/, faellt also unter denselben
// Cookie-Gate + Kill-Switch wie /internal/3d-ops (middleware.ts:16).
//
// Bewusste Entscheidungen:
//   - Beschriftung nur auf Deutsch. Eine Werkstatt-Seite bekommt keine
//     i18n-Keys, die spaeter niemand mehr aufraeumt.
//   - Experimentelle Farben stehen als Inline-Werte in den Entwuerfen, NICHT
//     als neue Tokens in globals.css. Ein Entwurf, der es nicht schafft,
//     wuerde sonst als toter Token zurueckbleiben.
//   - Die TFT-Bilder kommen ueber `loadTftAssets()`, also denselben Ladeweg
//     wie die echten Seiten. Kein zweiter Datenpfad, der auseinanderlaufen kann.

import { useEffect, useMemo, useState } from 'react';
import { loadTftAssets, type TftAssetsBundle } from '../../lib/tft-cdragon';
import {
  tftHeroUnitPool,
  pickForSeed,
  pickPairForSeed,
  type TftHeroUnit,
} from '../../lib/ddragon-splash';

const DD = 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash';

// Flaechenton mit Alpha. Seit dem ersten Umbau-Commit existiert
// `--surface-page-rgb` global in globals.css — der Fallback hier greift also
// nicht mehr. Die aelteren Entwuerfe weiter unten sollen den heutigen Ton
// behalten und verankern ihn deshalb SELBST auf ihrem Wrapper; nur der
// Auswahl-Reiter schaltet die Variable um.
const PAGE = (alpha: number) => `rgb(var(--surface-page-rgb, 14 21 37) / ${alpha * 100}%)`;

// Heutiger Flaechenton als Anker fuer die aelteren Entwuerfe. Ohne ihn wuerden
// sie beim globalen Farbwechsel mitziehen, waehrend ihre roh gesetzten Rahmen
// stehenbleiben — das Vergleichswerkzeug wuerde dann genau dort luegen, wofuer
// es gebaut ist.
const IST_PAGE_ANCHOR = { '--surface-page-rgb': '14 21 37' } as React.CSSProperties;

type Tab = 'auswahl' | 'home' | 'farbe' | 'tft';

export default function DesignLabPage() {
  const [tab, setTab] = useState<Tab>('auswahl');
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => {
    loadTftAssets().then(setAssets);
  }, []);

  const pool = useMemo(() => tftHeroUnitPool(assets), [assets]);

  return (
    <div className="min-h-screen bg-surface-page text-fg-primary">
      <header className="border-b border-border-subtle px-6 py-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold text-white">Design-Werkstatt</h1>
          <span className="text-xs text-fg-muted">
            intern · nichts davon ist live · {pool.length} Bild-Kandidaten geladen
          </span>
        </div>
        <nav className="mt-4 flex gap-2">
          {(
            [
              ['auswahl', 'Auswahl (F2 · T1 · S1+S3)'],
              ['home', 'Startseite'],
              ['farbe', 'Farbklima'],
              ['tft', 'TFT-Kopfzone'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                tab === id
                  ? 'bg-accent text-black font-semibold'
                  : 'bg-surface-overlay text-fg-secondary hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1240px] px-6 py-8">
        {tab === 'auswahl' && <FinalDraft pool={pool} />}
        {/* Die aelteren Entwuerfe zeigen den IST-Zustand und bleiben deshalb auf
            dem heutigen Flaechenton verankert, auch wenn globals.css spaeter
            wechselt. Nur der Auswahl-Reiter schaltet die Variable selbst um. */}
        {tab === 'home' && <div style={IST_PAGE_ANCHOR}><HomeDrafts pool={pool} /></div>}
        {tab === 'farbe' && <ColorDrafts />}
        {tab === 'tft' && <div style={IST_PAGE_ANCHOR}><TftDrafts pool={pool} /></div>}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ Buehne */

function Stage({
  nr,
  title,
  note,
  verdict,
  children,
}: {
  nr: string;
  title: string;
  note: string;
  verdict?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-xs text-accent">{nr}</span>
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <p className="text-xs text-fg-secondary">{note}</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border-subtle">{children}</div>
      {verdict && <p className="mt-2 text-xs text-fg-muted">{verdict}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ Auswahl */

// F2 auf die Toene der App gestreckt. F2 benennt sechs Werte, das System fuehrt
// elf. Die Zwischenstufen sind abgeleitet, nicht dazuerfunden: `base` liegt
// eine Stufe ueber der Flaeche, `overlay` eine ueber der Karte, und
// `border-default` muss heller bleiben als `border-subtle` — sonst kehrt sich
// die Rangfolge "leiser/lauter Rahmen" um.
//
// `--surface-page-rgb` ist seit dem ersten Umbau-Commit das Tripel aus
// globals.css und dort die Source-of-Truth der Flaeche: die Verlaeufe der
// Kopfzonen haengen nicht mehr an dezimalen `rgba(14,21,37,…)`-Literalen,
// sondern an dieser Variable — deshalb wandert beim Umschalten auch der
// Bildverlauf mit, statt als blaue Kante stehenzubleiben.
const IST_TOKENS = {
  '--surface-sunken': '#0a0e1a',
  '--surface-page': '#0e1525',
  '--surface-base': '#0d1526',
  '--surface-raised': '#141c2e',
  '--surface-overlay': '#1e2a3a',
  '--border-subtle': '#1e2a3a',
  '--border-default': '#2a3a50',
  '--fg-primary': '#ffffff',
  '--fg-secondary': '#a0b0c5',
  '--fg-muted': '#7a8aa0',
  '--surface-page-rgb': '14 21 37',
} as React.CSSProperties;

const F2_TOKENS = {
  '--surface-sunken': '#05090f',
  '--surface-page': '#080d18',
  '--surface-base': '#0f172b',
  '--surface-raised': '#16203a',
  '--surface-overlay': '#1e2a45',
  '--border-subtle': '#27334d',
  '--border-default': '#38476a',
  '--fg-primary': '#f2f4f8',
  '--fg-secondary': '#b9c4d6',
  '--fg-muted': '#93a0b8',
  '--surface-page-rgb': '8 13 24',
} as React.CSSProperties;

interface SiteStats {
  totalTeams: number;
  totalProPlayers: number;
  matchesAnalyzed: number;
}

interface TopChampion {
  id: string;
  name: string;
  games: number;
  winRate: number;
}

function FinalDraft({ pool }: { pool: TftHeroUnit[] }) {
  const [f2, setF2] = useState(true);
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [champs, setChamps] = useState<TopChampion[] | null>(null);
  const [setInfo, setSetInfo] = useState<{ setNumber: number; setName: string; latestPatch: string } | null>(null);

  useEffect(() => {
    // Echte Zahlen, echter Set-Name — kein Platzhalter. Was noch nicht da ist,
    // bleibt Skelett, statt eine Zahl zu behaupten.
    fetch('/api/homepage-stats')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return;
        // Die Route liefert die Kennzahlen unter `stats`, nicht flach.
        if (d.stats) setStats(d.stats);
        if (Array.isArray(d.topChampions)) setChamps(d.topChampions);
      })
      .catch(() => {});
    fetch('/tft-set.json')
      .then(r => (r.ok ? r.json() : null))
      .then(d => d && setSetInfo(d))
      .catch(() => {});
  }, []);

  const pair = pickPairForSeed(pool, '/tft/comps');

  return (
    <div style={f2 ? F2_TOKENS : IST_TOKENS}>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setF2(v => !v)}
          className="rounded bg-surface-overlay px-3 py-1.5 text-sm text-fg-secondary hover:text-white"
        >
          Farbklima: <strong>{f2 ? 'F2' : 'heute'}</strong> — umschalten
        </button>
        <span className="text-xs text-fg-muted">
          Umschalten wirkt auf beide Entwuerfe darunter, ueber dieselben Tokens, die spaeter in
          globals.css stehen.
        </span>
      </div>

      <p className="mb-8 max-w-3xl text-sm text-fg-secondary">
        Zwei Hinweise, damit die Vorschau nicht mehr verspricht als sie hält: Die 591 Stellen
        mit <code>text-white</code> in der App folgen dem Token <em>nicht</em> — dort bleibt
        Text reinweiß statt <code>#f2f4f8</code>. Und die Diagramme tragen ihre Farben als
        JS-Strings, sie ziehen erst mit dem Chart-Theme mit.
      </p>

      <Stage
        nr="T1 · voll"
        title="TFT-Kopfzone — zwei Set-Splashes, 180 px"
        note={
          setInfo
            ? `Set ${setInfo.setNumber} · ${setInfo.setName} · Patch ${setInfo.latestPatch}`
            : 'Set-Daten werden geladen…'
        }
        verdict={
          pair
            ? `Gezeigt: ${pair[0].name} und ${pair[1].name}. Beide Bilder tragen die Set-Bemalung; Grundskins und der von ddragon nicht ausgelieferte Blitzcrank-Skin sind aus dem Pool. Links und rechts können nicht mehr dasselbe Bild sein — gezogen wird ein Paar, nicht zweimal einzeln.`
            : 'Bildpool wird geladen…'
        }
      >
        <div
          data-game="tft"
          className="relative overflow-hidden"
          style={{
            height: 180,
            background:
              'radial-gradient(ellipse at top, rgb(var(--accent-rgb) / 22%) 0%, rgb(var(--surface-page-rgb) / 0%) 60%), linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-page) 100%)',
          }}
        >
          {pair && (
            <>
              <SideArt unit={pair[0]} side="left" />
              <SideArt unit={pair[1]} side="right" />
            </>
          )}
          <div className="relative z-10 flex h-full flex-col items-center justify-center">
            <div className="text-[10px] uppercase tracking-[0.3em] text-accent">
              {setInfo
                ? `Set ${setInfo.setNumber} · ${setInfo.setName} · Patch ${setInfo.latestPatch}`
                : ' '}
            </div>
            <div className="text-3xl font-bold text-fg-primary">Comps</div>
          </div>
        </div>
      </Stage>

      <Stage
        nr="S1 + S3"
        title="Startseite — Kai'Sa bleibt, die Zahlen rücken hoch"
        note="Abstand Suche → Meistgespielte Champions von 80 px auf 32 px"
        verdict="Die drei Zahlen stehen heute erst unterhalb der Reiter. Hier tragen sie die Kopfzone mit, ohne dass ein weiterer Block Höhe kostet. Es sind die echten Werte aus /api/homepage-stats — solange sie fehlen, steht dort ein Skelett und keine erfundene Zahl."
      >
        <div className="bg-surface-page">
          <div className="relative overflow-hidden">
            <img
              src={`${DD}/Kaisa_0.jpg`}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: '50% 18%' }}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgb(var(--surface-page-rgb) / 35%) 0%, rgb(var(--surface-page-rgb) / 55%) 45%, rgb(var(--surface-page-rgb) / 100%) 100%)',
              }}
            />
            <div className="relative flex flex-col items-center gap-6 px-6 pt-16 pb-8">
              <div className="text-center">
                <div className="text-4xl font-bold text-fg-primary">
                  meta<span className="text-accent">stats</span>.gg
                </div>
                <p className="mt-2 text-sm text-fg-secondary">
                  Marktwerte, Meta und Pro-Daten für League of Legends und Teamfight Tactics
                </p>
              </div>
              <SearchBar />
              <div className="flex flex-wrap justify-center gap-x-12 gap-y-4">
                {[
                  ['Analysierte Partien', stats?.matchesAnalyzed],
                  ['Pro-Spieler', stats?.totalProPlayers],
                  ['Verifizierte Teams', stats?.totalTeams],
                ].map(([label, value]) => (
                  <div key={String(label)} className="text-center">
                    {typeof value === 'number' ? (
                      <div className="text-xl font-bold text-fg-primary">
                        {value.toLocaleString('de-DE')}
                      </div>
                    ) : (
                      <div className="mx-auto my-1 h-5 w-20 animate-pulse rounded bg-surface-overlay" />
                    )}
                    <div className="text-[11px] uppercase tracking-wider text-fg-muted">
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="px-8 pt-8 pb-8">
            <div className="mb-4 flex items-baseline gap-3">
              <span className="text-lg font-bold text-fg-primary">Meistgespielte Champions</span>
              <span className="text-xs text-fg-muted">letzte 7 Tage · EUW</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {/* Aufbau wie live in app/page.tsx: Splash als Kartenkopf, Name und
                  Zahlen darauf. Sonst vergleicht die Vorschau zwei verschiedene
                  Karten und nicht zwei Farbklimas. */}
              {(champs ?? [null, null, null]).slice(0, 3).map((c, i) => (
                <div
                  key={c?.id ?? i}
                  className="overflow-hidden rounded-xl border border-border-subtle bg-surface-raised"
                >
                  <div className="relative h-36 overflow-hidden">
                    {c ? (
                      <>
                        <img
                          src={`${DD}/${c.id}_0.jpg`}
                          alt={c.name}
                          className="h-full w-full object-cover object-top"
                          style={{ filter: 'brightness(0.5)' }}
                        />
                        <div
                          className="pointer-events-none absolute inset-0"
                          style={{
                            background: `linear-gradient(to top, var(--surface-raised) 0%, ${PAGE(0)} 60%)`,
                          }}
                        />
                        <div className="absolute bottom-3 left-4">
                          <div className="flex items-center gap-2">
                            <span
                              className="rounded px-1.5 py-0.5 text-xs font-bold text-accent"
                              style={{ background: 'rgb(var(--accent-rgb) / 20%)' }}
                            >
                              #{i + 1}
                            </span>
                            <span className="text-lg font-semibold text-fg-primary">{c.name}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-fg-secondary">
                            {c.games.toLocaleString('de-DE')} Spiele ·{' '}
                            {c.winRate.toLocaleString('de-DE', { minimumFractionDigits: 1 })} % WR
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="h-full w-full animate-pulse bg-surface-overlay" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Stage>
    </div>
  );
}

/* ------------------------------------------------------------- Startseite */

function SearchBar({ accent = '#c89b3c' }: { accent?: string }) {
  return (
    <div className="flex w-full max-w-xl overflow-hidden rounded-md border border-border-subtle bg-surface-overlay">
      <span className="flex items-center px-3 text-sm text-fg-muted">EUW</span>
      <span className="flex-1 py-2.5 text-sm text-fg-muted">Spieler suchen… (Name#EUW)</span>
      <span
        className="px-6 py-2.5 text-sm font-semibold text-black"
        style={{ background: accent }}
      >
        Suchen
      </span>
    </div>
  );
}

function HomeDrafts({ pool }: { pool: TftHeroUnit[] }) {
  const tftUnit = pickForSeed(pool, '/');

  return (
    <>
      <p className="mb-8 max-w-3xl text-sm text-fg-secondary">
        Die Frage hinter allen Entwuerfen: Die Startseite bedient zwei Spiele, zeigt aber
        einen einzelnen LoL-Champion. Jeder Entwurf beantwortet anders, was oben stehen
        soll — Bild, Marke oder Daten.
      </p>

      <Stage
        nr="S1"
        title="Heutiger Zustand — Kai'Sa als Vollflaeche"
        note="ein LoL-Champion hinter der Wortmarke, stark abgedunkelt"
        verdict="Problem: das Bild ist so weit abgedunkelt, dass es nicht mehr als Artwork wirkt, sondern als Rauschen. Kai'Sas Gesicht liegt genau hinter der Wortmarke. Und ein LoL-Champion vertritt eine Seite, die auch TFT fuehrt."
      >
        <div className="relative h-[330px] overflow-hidden bg-surface-page">
          <img
            src={`${DD}/Kaisa_0.jpg`}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: '50% 22%', opacity: 0.55 }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(14,21,37,0.75) 0%, rgba(14,21,37,0.55) 45%, rgba(14,21,37,1) 100%)',
            }}
          />
          <div className="relative flex h-full flex-col items-center justify-center gap-6 px-6">
            <div className="text-4xl font-bold text-white">
              meta<span style={{ color: '#c89b3c' }}>stats</span>.gg
            </div>
            <SearchBar />
          </div>
        </div>
      </Stage>

      <Stage
        nr="S2"
        title="Zwei Spiele, zwei Tueren"
        note="je eine Bildkarte pro Spiel, Suche darunter"
        verdict="Loest den Grundkonflikt: kein Spiel wird bevorzugt, und beide Karten tragen echtes Artwork statt eines abgedunkelten Hintergrunds. Mobalytics faehrt dieses Prinzip mit vier Spielen. Preis: die Suche rutscht nach unten."
      >
        <div className="bg-surface-page px-8 py-8">
          <div className="mb-6 text-center text-3xl font-bold text-white">
            meta<span style={{ color: '#c89b3c' }}>stats</span>.gg
          </div>
          <div className="mb-6 grid grid-cols-2 gap-4">
            <GameCard
              label="League of Legends"
              sub="Marktwerte · Pro-Teams · Champions"
              img={`${DD}/Ahri_0.jpg`}
              accent="#c89b3c"
            />
            <GameCard
              label="Teamfight Tactics"
              sub={`Comps · Einheiten · Set ${tftUnit ? '17' : '—'}`}
              img={tftUnit ? tftUnit.splash.url : `${DD}/Bard_0.jpg`}
              accent="#7B61FF"
            />
          </div>
          <div className="flex justify-center">
            <SearchBar />
          </div>
        </div>
      </Stage>

      <Stage
        nr="S3"
        title="Daten statt Bild"
        note="kein Artwork, dafuer die Zahlen, die sonst weiter unten stehen"
        verdict="Der ehrlichste Entwurf: die Seite verkauft Daten, also stehen Daten oben. Schnellste Ladezeit von allen (kein 150-KB-Splash im kritischen Pfad). Risiko: wirkt naeher an einem Werkzeug als an einer Marke."
      >
        <div
          className="relative h-[330px] overflow-hidden"
          style={{
            background:
              'radial-gradient(ellipse at 50% -20%, rgba(200,155,60,0.10) 0%, rgba(14,21,37,0) 55%), #0e1525',
          }}
        >
          <div
            className="absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(120,140,180,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(120,140,180,0.35) 1px, transparent 1px)',
              backgroundSize: '56px 56px',
              maskImage: 'radial-gradient(ellipse at 50% 0%, #000 0%, transparent 75%)',
            }}
          />
          <div className="relative flex h-full flex-col items-center justify-center gap-7 px-6">
            <div className="text-center">
              <div className="text-4xl font-bold text-white">
                meta<span style={{ color: '#c89b3c' }}>stats</span>.gg
              </div>
              <p className="mt-2 text-sm text-fg-secondary">
                Marktwerte, Meta und Pro-Daten für League of Legends und TFT
              </p>
            </div>
            <SearchBar />
            <div className="flex gap-10">
              {[
                ['5.860.412', 'Analysierte Partien'],
                ['1.341', 'Pro-Spieler'],
                ['520', 'Verifizierte Teams'],
              ].map(([v, l]) => (
                <div key={l} className="text-center">
                  <div className="text-xl font-bold text-white">{v}</div>
                  <div className="text-[11px] uppercase tracking-wider text-fg-muted">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Stage>

      <Stage
        nr="S4"
        title="Portraet rechts, Text links"
        note="Artwork als Bildhaelfte statt als Hintergrund — Produkt-Hero"
        verdict="Das Bild darf endlich Bild sein: nicht abgedunkelt, nicht hinter Text. Der Champion bleibt austauschbar (taeglich der meistgespielte). Auf Mobil klappt die Bildhaelfte weg."
      >
        <div className="relative grid h-[330px] grid-cols-2 overflow-hidden bg-surface-page">
          <div className="flex flex-col justify-center gap-5 px-10">
            <div className="text-4xl font-bold leading-tight text-white">
              meta<span style={{ color: '#c89b3c' }}>stats</span>.gg
            </div>
            <p className="max-w-sm text-sm text-fg-secondary">
              Marktwerte, Meta und Pro-Daten für League of Legends und Teamfight Tactics.
            </p>
            <SearchBar />
          </div>
          <div className="relative overflow-hidden">
            <img
              src={`${DD}/Ahri_0.jpg`}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: '40% 20%' }}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(90deg, #0e1525 0%, rgba(14,21,37,0.55) 35%, rgba(14,21,37,0) 100%)',
              }}
            />
          </div>
        </div>
      </Stage>

      <Stage
        nr="S5"
        title="Schmaler Kopf, Inhalt sofort"
        note="Suche in einer Zeile, darunter direkt die Daten"
        verdict="Maximale Dichte: der Nutzer sieht ohne Scrollen echte Inhalte. Das ist der Weg, den Werkzeug-Seiten gehen, wenn Stammnutzer ueberwiegen. Kostet jede Markenwirkung."
      >
        <div className="bg-surface-page">
          <div className="flex items-center gap-6 border-b border-border-subtle px-8 py-4">
            <div className="text-lg font-bold text-white">
              meta<span style={{ color: '#c89b3c' }}>stats</span>.gg
            </div>
            <SearchBar />
          </div>
          <div className="grid grid-cols-3 gap-4 px-8 py-6">
            {['Senna', 'Sylas', 'Nautilus'].map((c, i) => (
              <div key={c} className="relative h-24 overflow-hidden rounded-md">
                <img
                  src={`${DD}/${c}_0.jpg`}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{ objectPosition: '50% 20%' }}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background: 'linear-gradient(180deg, rgba(14,21,37,0) 30%, rgba(14,21,37,0.92) 100%)',
                  }}
                />
                <div className="absolute bottom-2 left-3 text-sm font-semibold text-white">
                  #{i + 1} {c}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Stage>
    </>
  );
}

function GameCard({
  label,
  sub,
  img,
  accent,
}: {
  label: string;
  sub: string;
  img: string;
  accent: string;
}) {
  return (
    <div className="relative h-[150px] overflow-hidden rounded-lg">
      <img
        src={img}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: '50% 22%' }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(14,21,37,0.15) 0%, rgba(14,21,37,0.85) 70%, rgba(14,21,37,0.97) 100%)',
        }}
      />
      <div className="absolute inset-x-0 bottom-0 p-4">
        <div className="text-lg font-bold text-white">{label}</div>
        <div className="text-xs" style={{ color: accent }}>
          {sub}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: accent }} />
    </div>
  );
}

/* --------------------------------------------------------------- Farbklima */

interface Palette {
  nr: string;
  name: string;
  note: string;
  page: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
}

const PALETTES: Palette[] = [
  {
    nr: 'F1',
    name: 'Heutiger Zustand',
    note: 'Flaeche #0e1525, Karte #131c2f — Abstand zwischen den Ebenen ist klein',
    page: '#0e1525',
    card: '#131c2f',
    border: '#1e2a3a',
    text: '#ededed',
    muted: '#8b97ab',
    accent: '#c89b3c',
  },
  {
    nr: 'F2',
    name: 'Deutlichere Ebenen',
    note: 'gleiche Farbfamilie, Grundflaeche dunkler, Karten heller — Karten heben sich ab',
    page: '#080d18',
    card: '#16203a',
    border: '#27334d',
    text: '#f2f4f8',
    muted: '#93a0b8',
    accent: '#c89b3c',
  },
  {
    nr: 'F3',
    name: 'Entsaettigtes Anthrazit',
    note: 'Blaustich raus — die Farbe kommt dann nur noch vom Spiel-Akzent',
    page: '#0f1114',
    card: '#181b20',
    border: '#272b33',
    text: '#eceef1',
    muted: '#949aa4',
    accent: '#c89b3c',
  },
  {
    nr: 'F4',
    name: 'Waermer und heller',
    note: 'Grundflaeche angehoben, leicht warm — gegen den Hoehlen-Eindruck bei langen Sitzungen',
    page: '#151822',
    card: '#1e222e',
    border: '#2d3240',
    text: '#f0efec',
    muted: '#9a9daa',
    accent: '#d3a752',
  },
];

function ColorDrafts() {
  return (
    <>
      <p className="mb-8 max-w-3xl text-sm text-fg-secondary">
        Dieselbe Zeile in vier Farbklimas. Zu beurteilen ist nicht der Einzelton, sondern
        der Abstand: hebt sich die Karte von der Flaeche ab, bleibt Text lesbar, sticht der
        Akzent noch heraus.
      </p>
      {PALETTES.map(p => (
        <Stage key={p.nr} nr={p.nr} title={p.name} note={p.note}>
          <PaletteRow p={p} />
        </Stage>
      ))}
    </>
  );
}

function PaletteRow({ p }: { p: Palette }) {
  return (
    <div style={{ background: p.page }} className="p-6">
      <div className="mb-4 flex items-baseline gap-3">
        <span style={{ color: p.text }} className="text-lg font-bold">
          Meistgespielte Champions
        </span>
        <span style={{ color: p.muted }} className="text-xs">
          letzte 7 Tage · EUW
        </span>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[
          ['Senna', '1.702', '53,7 %'],
          ['Sylas', '1.311', '52,4 %'],
          ['Nautilus', '1.068', '54,2 %'],
        ].map(([name, games, wr]) => (
          <div
            key={name}
            className="rounded-lg p-4"
            style={{ background: p.card, border: `1px solid ${p.border}` }}
          >
            <div style={{ color: p.text }} className="text-sm font-semibold">
              {name}
            </div>
            <div style={{ color: p.muted }} className="mt-1 text-xs">
              {games} Spiele
            </div>
            <div style={{ color: p.accent }} className="mt-3 text-xl font-bold">
              {wr}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-3">
        <span
          className="rounded px-4 py-2 text-sm font-semibold text-black"
          style={{ background: p.accent }}
        >
          Suchen
        </span>
        <span
          className="rounded px-4 py-2 text-sm"
          style={{ background: p.card, border: `1px solid ${p.border}`, color: p.text }}
        >
          Zweitaktion
        </span>
        <span style={{ color: p.muted }} className="text-xs">
          Flaeche {p.page} · Karte {p.card}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ TFT-Kopfzone */

function TftDrafts({ pool }: { pool: TftHeroUnit[] }) {
  const [compact, setCompact] = useState(false);
  const h = compact ? 88 : 180;

  const a = pickForSeed(pool, '/tft/comps');
  const b = pickForSeed(pool, '/tft/units');

  if (pool.length === 0) {
    return <p className="text-sm text-fg-secondary">Asset-Bundle wird geladen…</p>;
  }

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => setCompact(c => !c)}
          className="rounded bg-surface-overlay px-3 py-1.5 text-sm text-fg-secondary hover:text-white"
        >
          {compact ? 'schmal (88 px)' : 'voll (180 px)'} — umschalten
        </button>
        <span className="text-xs text-fg-muted">
          Pool: {pool.map(u => u.name).join(', ')}
        </span>
      </div>

      <p className="mb-8 max-w-3xl text-sm text-fg-secondary">
        Alle Bilder sind die <strong>Set-Bemalung</strong> der 5-Kosten-Einheiten, aus dem
        Asset-Bundle abgeleitet — nicht der Grundskin. Die Auswahl haengt am Seitenpfad,
        nicht am Zufall und nicht an Win-Raten.
      </p>

      <Stage
        nr="T1"
        title="Zweiseitig wie bei LoL"
        note="zwei Set-Splashes links und rechts, Text mittig"
        verdict="Gleiche Bildsprache wie die LoL-Reiter. Genau das ist auch der Einwand: ohne TFT-eigenes Merkmal sehen beide Spiele identisch aus."
      >
        <TftFrame h={h}>
          <SideArt unit={a} side="left" />
          <SideArt unit={b} side="right" />
          <CenterText compact={compact} />
        </TftFrame>
      </Stage>

      <Stage
        nr="T2"
        title="Einseitig, Text linksbuendig"
        note="ein Bild rechts, Ueberschrift links am Raster"
        verdict="Bester Kompromiss fuer Datenseiten: die Ueberschrift steht dort, wo darunter die Tabelle beginnt, das Bild fuellt nur den sonst leeren Rest."
      >
        <TftFrame h={h}>
          <SideArt unit={a} side="right" wide />
          <div className="relative z-10 flex h-full flex-col justify-center px-8">
            <div className="text-[10px] uppercase tracking-[0.3em] text-accent">Set 17</div>
            <div className={`font-bold text-white ${compact ? 'text-xl' : 'text-3xl'}`}>
              Comps
            </div>
          </div>
        </TftFrame>
      </Stage>

      <Stage
        nr="T3"
        title="Bildband"
        note="das Splash als schmaler Querstreifen, stark abgedunkelt"
        verdict="Kostet fast keine Hoehe und traegt trotzdem Bild. Das Motiv ist dabei nur noch Textur, kein erkennbarer Champion."
      >
        <TftFrame h={compact ? 64 : 120}>
          {a && (
            <img
              src={a.splash.url}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: '50% 30%', opacity: 0.45 }}
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, #0e1525 0%, rgba(14,21,37,0.55) 50%, #0e1525 100%)',
            }}
          />
          <CenterText compact={compact} />
        </TftFrame>
      </Stage>

      <Stage
        nr="T4"
        title="Vollflaeche"
        note="ein Splash ueber die ganze Breite"
        verdict="Vom Bildsprache-Review zum Streichen vorgeschlagen: maximale Hoehe, kein Informationsgewinn — derselbe Fehler wie heute auf der Startseite. Steht hier nur zum Vergleich."
      >
        <TftFrame h={compact ? 120 : 240}>
          {a && (
            <img
              src={a.splash.url}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: '50% 25%', opacity: 0.7 }}
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(14,21,37,0.6) 0%, rgba(14,21,37,0.35) 50%, #0e1525 100%)',
            }}
          />
          <CenterText compact={compact} />
        </TftFrame>
      </Stage>

      <Stage
        nr="T5"
        title="Set-Bild plus kleine Figur"
        note="Splash rechts, eine kleine Chibi-Figur links als TFT-Merkmal"
        verdict="Loest den Einwand aus T1: die Figur ist das Zeichen, das es bei LoL nicht gibt — aber klein genug, dass sie die Kopfzone nicht mehr traegt."
      >
        <TftFrame h={h}>
          <SideArt unit={b} side="right" wide />
          <div className="relative z-10 flex h-full items-center gap-5 px-8">
            <div
              className="shrink-0 rounded-full"
              style={{
                width: compact ? 44 : 68,
                height: compact ? 44 : 68,
                background:
                  'radial-gradient(circle at 40% 35%, rgba(123,97,255,0.55), rgba(123,97,255,0.08))',
                border: '1px solid rgba(123,97,255,0.45)',
              }}
            />
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-accent">Set 17</div>
              <div className={`font-bold text-white ${compact ? 'text-xl' : 'text-3xl'}`}>
                Comps
              </div>
            </div>
          </div>
        </TftFrame>
      </Stage>

      <Stage
        nr="T6"
        title="Ohne Bild"
        note="nur Verlauf und Text — das, was tactics.tools und tftacademy machen"
        verdict="Der ehrliche Vergleichsmassstab. Wenn ein Bildentwurf hiergegen nicht spuerbar gewinnt, ist das Bild nur Ballast."
      >
        <TftFrame h={compact ? 64 : 120}>
          <CenterText compact={compact} />
        </TftFrame>
      </Stage>
    </>
  );
}

function TftFrame({ h, children }: { h: number; children: React.ReactNode }) {
  return (
    // `data-game="tft"` ist hier Pflicht, nicht Deko: /internal/* liegt
    // ausserhalb des Ankers aus app/tft/layout.tsx, also waere `text-accent`
    // in der Vorschau Gold statt Lila — die Entwuerfe saehen anders aus als
    // spaeter auf der echten Seite.
    <div
      data-game="tft"
      className="relative overflow-hidden"
      style={{
        height: h,
        background:
          'radial-gradient(ellipse at top, rgba(123,97,255,0.22) 0%, rgba(14,21,37,0) 60%), linear-gradient(180deg, #141a2e 0%, #0e1525 100%)',
      }}
    >
      {children}
    </div>
  );
}

function CenterText({ compact }: { compact: boolean }) {
  return (
    <div className="relative z-10 flex h-full flex-col items-center justify-center">
      <div className="text-[10px] uppercase tracking-[0.3em] text-accent">
        Set 17 · Patch 17.8
      </div>
      <div className={`font-bold text-white ${compact ? 'text-xl' : 'text-3xl'}`}>Comps</div>
    </div>
  );
}

function SideArt({
  unit,
  side,
  wide = false,
}: {
  unit: TftHeroUnit | null;
  side: 'left' | 'right';
  wide?: boolean;
}) {
  if (!unit) return null;
  const w = wide ? '48%' : '35%';
  return (
    <div
      className="absolute top-0 bottom-0 overflow-hidden"
      style={{ [side]: 0, width: w } as React.CSSProperties}
      title={`${unit.name} · ${unit.splash.championId}_${unit.splash.skinNum}`}
    >
      <img
        src={unit.splash.url}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          filter: 'brightness(1.12)',
          objectPosition: side === 'left' ? '70% 15%' : '30% 15%',
        }}
        onError={e => {
          // KEIN Rueckfall auf den Grundskin: das Bild ist dann Artwork aus
          // einer anderen Zeit und faellt neben dem zweiten Set-Bild sofort
          // auf. Lieber eine leere Seite als ein fremdes Bild.
          (e.currentTarget as HTMLImageElement).style.opacity = '0';
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          // Bild aussen, Verlauf nach innen: links liegendes Bild blendet nach
          // rechts ins Blau aus, rechts liegendes nach links.
          background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, ${PAGE(0)} 0%, ${PAGE(0.15)} 60%, ${PAGE(1)} 100%)`,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to bottom, ${PAGE(0)} 0%, ${PAGE(0)} 60%, ${PAGE(1)} 100%)`,
        }}
      />
    </div>
  );
}
