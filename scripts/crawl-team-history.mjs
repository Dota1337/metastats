/**
 * Fetches COMPLETE tournament history + prize money for ALL teams in pro-teams.json.
 * Queries Leaguepedia per-team. Converts all currencies to USD.
 */

const CARGO_API = 'https://lol.fandom.com/wiki/Special:CargoExport';

const EXCHANGE_RATES = {
  'USD': 1, '$': 1, 'EUR': 1.08, 'GBP': 1.26, 'KRW': 0.00073,
  'CNY': 0.14, 'JPY': 0.0065, 'BRL': 0.19, 'TRY': 0.029, 'RUB': 0.011,
  'VND': 0.000039, 'TWD': 0.031, 'THB': 0.028, 'PHP': 0.017, 'PLN': 0.25,
  'SEK': 0.093, 'DKK': 0.15, 'CZK': 0.043, 'AUD': 0.64, 'CAD': 0.73,
  'MYR': 0.21, 'SGD': 0.74, 'HKD': 0.13, 'MXN': 0.057, 'ARS': 0.0011,
  'CLP': 0.0010, 'PEN': 0.26, 'COP': 0.00023,
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function stripHtml(s) { return (s || '').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#039;/g, "'"); }

function parsePrize(prizeStr, currency) {
  if (!prizeStr) return 0;
  const numStr = String(prizeStr).replace(/[^0-9.,]/g, '').replace(/,/g, '');
  let amount = parseFloat(numStr);
  if (isNaN(amount)) return 0;
  const curr = (currency || 'USD').trim().toUpperCase();
  const rate = EXCHANGE_RATES[curr] || 1;
  return Math.round(amount * rate);
}

function getTrophy(place) {
  const p = String(place || '').toLowerCase().trim();
  if (p === '1' || p === '1st') return 'gold';
  if (p === '2' || p === '2nd') return 'silver';
  if (p.startsWith('3') || p === '3rd-4th' || p === '3-4' || p === '3rd - 4th') return 'bronze';
  return null;
}

async function fetchTeamResults(teamName) {
  const params = new URLSearchParams({
    tables: 'TournamentResults=TR',
    fields: 'TR.Event,TR.Place,TR.Date,TR.Prize,TR.PrizeUnit',
    where: `TR.Team="${teamName.replace(/"/g, '\\"')}"`,
    'order by': 'TR.Date DESC',
    limit: '100',
    format: 'json',
  });
  try {
    const res = await fetch(`${CARGO_API}?${params}`, { headers: { 'User-Agent': 'metastats.gg' } });
    if (!res.ok) return [];
    const text = await res.text();
    if (!text.startsWith('[')) return [];
    return JSON.parse(text);
  } catch { return []; }
}

async function main() {
  console.log('=== Team History Crawler (per-Team Queries) ===\n');

  const fs = await import('fs');
  let teamsData;
  try {
    teamsData = JSON.parse(fs.readFileSync('public/pro-teams.json', 'utf8'));
  } catch {
    console.error('public/pro-teams.json nicht gefunden. Erst crawl-pro-teams.mjs ausfuehren!');
    process.exit(1);
  }

  const teams = teamsData.teams;
  console.log(`${teams.length} Teams zu verarbeiten\n`);

  let enriched = 0;
  let totalQueries = 0;
  let totalResults = 0;

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    const results = await fetchTeamResults(team.name);
    totalQueries++;
    totalResults += results.length;

    if (results.length > 0) {
      const processed = results.map(r => {
        const event = stripHtml(r.Event || '');
        const prizeUSD = parsePrize(r.Prize, r.PrizeUnit);
        const trophy = getTrophy(r.Place);
        return {
          event,
          place: r.Place || '',
          date: r.Date || '',
          prizeUSD,
          originalPrize: r.Prize ? `${r.Prize} ${r.PrizeUnit || ''}`.trim() : '',
          trophy,
        };
      });

      team.results = processed;
      team.totalPrizeMoney = processed.reduce((s, r) => s + r.prizeUSD, 0);
      team.trophies = processed.filter(r => r.trophy).map(r => ({
        event: r.event, place: r.place, trophy: r.trophy, date: r.date,
      }));
      enriched++;
    }

    if ((i + 1) % 25 === 0 || i === teams.length - 1) {
      console.log(`  ${i + 1}/${teams.length} Teams abgefragt (${totalResults} Ergebnisse, ${enriched} angereichert)`);
    }

    // Rate limit: 1 request per 200ms
    if (totalQueries % 50 === 0) {
      await sleep(2000);
    } else {
      await sleep(200);
    }
  }

  // Re-sort by prize money
  teams.sort((a, b) => (b.totalPrizeMoney || 0) - (a.totalPrizeMoney || 0));
  teamsData.updatedAt = new Date().toISOString();

  fs.writeFileSync('public/pro-teams.json', JSON.stringify(teamsData));
  console.log(`\n  ${enriched}/${teams.length} Teams mit Historie angereichert`);
  console.log(`  ${totalResults} Turnierergebnisse gesamt`);
  console.log('  -> public/pro-teams.json aktualisiert\n');

  console.log('=== Top 15 Teams (Preisgeld in USD) ===');
  teams.slice(0, 15).forEach((t, i) => {
    const golds = (t.trophies || []).filter(tr => tr.trophy === 'gold').length;
    console.log(`  ${i + 1}. ${t.name} | $${(t.totalPrizeMoney || 0).toLocaleString()} | ${golds} Siege | ${(t.trophies || []).length} Podien | ${(t.results || []).length} Turniere`);
  });

  console.log('\nFertig!');
}

main().catch(e => { console.error(e); process.exit(1); });
