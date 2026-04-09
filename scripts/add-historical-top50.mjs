import fs from 'fs';

const d = JSON.parse(fs.readFileSync('public/pro-teams.json', 'utf8'));

function addResults(teamName, historical) {
  const team = d.teams.find(t => t.name === teamName);
  if (!team) { console.log('NOT FOUND:', teamName); return; }
  const existingKeys = new Set(team.results.map(r => r.event + '|' + r.date));
  let added = 0;
  for (const r of historical) {
    if (!existingKeys.has(r.event + '|' + r.date)) {
      team.results.push(r);
      added++;
    }
  }
  team.results.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  team.trophies = team.results.filter(r => r.trophy).map(r => ({
    event: r.event, place: r.place, trophy: r.trophy, date: r.date
  }));
  const earliest = team.results[team.results.length - 1];
  console.log(`${teamName}: +${added}, total ${team.results.length}, earliest: ${earliest?.date}`);
}

function r(event, place, date, prizeUSD, trophy) {
  return { event, place, date, prizeUSD, originalPrize: prizeUSD > 0 ? `${prizeUSD} USD` : '', trophy };
}

// === Fnatic: 2011-2015 early results ===
addResults('Fnatic', [
  r('Riot Season 1 Championship', 1, '2011-06-20', 50000, 'gold'),
  r('IEM Season VI New York', 1, '2011-10-26', 12000, 'gold'),
  r('IEM Season VI Cologne', 3, '2011-08-21', 3400, 'bronze'),
  r('IEM Season VI World Championship', '9-10', '2012-03-10', 2100, null),
  r('IEM Season VII Cologne', 2, '2012-12-16', 8500, 'silver'),
  r('IEM Season VII Katowice', '3-4', '2013-01-20', 4500, 'bronze'),
  r('EU LCS 2013 Spring', 1, '2013-04-28', 50000, 'gold'),
  r('EU LCS 2013 Summer', 1, '2013-08-25', 50000, 'gold'),
  r('Season 3 World Championship', '3-4', '2013-09-28', 150000, 'bronze'),
  r('EU LCS 2014 Spring', 1, '2014-04-17', 50000, 'gold'),
  r('EU LCS 2015 Spring', 1, '2015-04-19', 50000, 'gold'),
  r('EU LCS 2015 Summer', 1, '2015-08-23', 50000, 'gold'),
  r('2015 World Championship', '3-4', '2015-10-25', 150000, 'bronze'),
]);

// === G2 Esports: 2015-2019 ===
addResults('G2 Esports', [
  r('EU CS Spring 2015', 4, '2015-04-08', 2880, null),
  r('EU CS Summer 2015', 3, '2015-08-12', 4417, 'bronze'),
  r('PGL Legends of The Rift Season 1', 3, '2015-11-15', 5407, 'bronze'),
  r('EU LCS 2016 Spring', 1, '2016-04-17', 50000, 'gold'),
  r('EU LCS 2016 Summer', 1, '2016-08-28', 56004, 'gold'),
  r('2016 World Championship', '13-16', '2016-10-07', 63375, null),
  r('EU LCS 2017 Spring', 1, '2017-04-23', 85720, 'gold'),
  r('2017 Mid-Season Invitational', 2, '2017-05-21', 338000, 'silver'),
  r('EU LCS 2017 Summer', 1, '2017-09-03', 95280, 'gold'),
  r('2017 World Championship', '9-11', '2017-10-13', 111307, null),
  r('EU LCS 2018 Spring', 2, '2018-04-08', 61372, 'silver'),
  r('EU LCS 2018 Summer', '5-6', '2018-08-25', 11620, null),
  r('2018 World Championship', '3-4', '2018-10-27', 451500, 'bronze'),
  r('EU LCS 2019 Spring', 1, '2019-04-14', 90088, 'gold'),
  r('2019 Mid-Season Invitational', 1, '2019-05-19', 400000, 'gold'),
  r('LEC 2019 Summer', 1, '2019-09-08', 88288, 'gold'),
  r('2019 World Championship', 2, '2019-11-10', 300375, 'silver'),
]);

// === Invictus Gaming: 2011-2018 ===
addResults('Invictus Gaming', [
  r('IEM Season VI Guangzhou', '5-6', '2011-10-03', 2100, null),
  r('Season 2 World Championship', '5-8', '2012-10-05', 75000, null),
  r('World e-Sports Masters 2012', 2, '2012-10-27', 11000, 'silver'),
  r('Tencent Games Arena Season 3', 3, '2012-11-21', 8034, 'bronze'),
  r('LPL 2013 Spring', 3, '2013-06-23', 32671, 'bronze'),
  r('IEM Season VIII Shanghai', 2, '2013-07-26', 8000, 'silver'),
  r('LPL 2013 Summer', 5, '2013-11-24', 16428, null),
  r('IEM Season VIII Singapore', 1, '2013-12-01', 25000, 'gold'),
  r('Demacia Cup Season 1', 1, '2014-01-03', 16548, 'gold'),
  r('IEM Season VIII World Championship', '5-6', '2014-03-15', 8500, null),
  r('International Esports Tournament 2014', 3, '2014-04-29', 8006, 'bronze'),
  r('LPL 2014 Spring', 2, '2014-05-24', 48165, 'silver'),
  r('LPL 2014 Summer', 6, '2014-08-24', 16274, null),
  r('LPL 2018 Spring', 4, '2018-04-24', 47410, null),
  r('LPL 2018 Summer', 2, '2018-09-14', 117044, 'silver'),
  r('2018 World Championship', 1, '2018-11-03', 2418750, 'gold'),
]);

// === EDward Gaming: 2014-2021 ===
addResults('EDward Gaming', [
  r('International Esports Tournament 2014', 1, '2014-04-29', 32023, 'gold'),
  r('LPL 2014 Spring', 1, '2014-05-24', 80274, 'gold'),
  r('LPL 2014 Summer', 1, '2014-08-24', 81371, 'gold'),
  r('2014 World Championship', '5-8', '2014-10-05', 75000, null),
  r('NVIDIA Game Festival 2014', 1, '2014-10-26', 16368, 'gold'),
  r('NEST 2014', 2, '2014-11-29', 11398, 'silver'),
  r('Demacia Cup Season 2', 1, '2014-12-13', 48553, 'gold'),
  r('LPL 2021 Summer', 1, '2021-09-02', 309897, 'gold'),
  r('2021 World Championship', 1, '2021-11-06', 489500, 'gold'),
]);

// === Bilibili Gaming: additional results ===
addResults('Bilibili Gaming', [
  r('LPL 2018 Spring', '5-6', '2018-04-15', 31607, null),
  r('NEST 2019', 2, '2019-05-26', 21737, 'silver'),
  r('LPL 2019 Summer', 4, '2019-09-04', 42032, null),
  r('Demacia Cup 2022', 1, '2022-12-27', 71876, 'gold'),
  r('NEST 2022', 3, '2022-11-20', 11236, 'bronze'),
  r('LPL 2023 Spring', 2, '2023-04-15', 145584, 'silver'),
  r('LPL 2023 Summer', 3, '2023-08-01', 69788, 'bronze'),
  r('Demacia Cup 2023', 1, '2024-01-06', 70398, 'gold'),
  r('LPL 2024 Spring', 1, '2024-04-20', 276251, 'gold'),
  r('LPL 2024 Summer', 1, '2024-08-30', 281964, 'gold'),
  r('LPL 2025 Split 1', 4, '2025-02-26', 13729, null),
  r('LPL 2025 Split 2', 2, '2025-06-14', 97471, 'silver'),
  r('LPL 2025 Split 3', 1, '2025-09-21', 323333, 'gold'),
  r('2026 First Stand Tournament', 1, '2026-03-22', 250000, 'gold'),
  r('LPL 2026 Split 1', 1, '2026-03-08', 101497, 'gold'),
]);

// === Top Esports: additional results ===
addResults('Top Esports', [
  r('LPL 2018 Summer', 6, '2018-09-07', 29261, null),
  r('NEST 2018', 2, '2018-11-18', 21642, 'silver'),
  r('LPL 2019 Spring', 4, '2019-04-17', 44801, null),
  r('LPL 2019 Summer', 3, '2019-09-04', 70053, 'bronze'),
  r('LPL 2020 Spring', 2, '2020-05-02', 141593, 'silver'),
  r('2020 Mid-Season Cup', 1, '2020-05-31', 240000, 'gold'),
  r('LPL 2020 Summer', 1, '2020-08-27', 290267, 'gold'),
  r('2020 World Championship', '3-4', '2020-10-25', 200250, 'bronze'),
  r('LPL 2021 Spring', 4, '2021-04-10', 46005, null),
  r('LPL 2022 Spring', 2, '2022-04-23', 153806, 'silver'),
  r('LPL 2022 Summer', 2, '2022-09-01', 144921, 'silver'),
  r('2022 World Championship', '9-10', '2022-10-15', 55625, null),
  r('LPL 2023 Summer', 4, '2023-07-29', 41873, null),
  r('LPL 2024 Spring', 2, '2024-04-20', 138125, 'silver'),
  r('LPL 2024 Summer', 3, '2024-08-24', 70491, 'bronze'),
  r('2024 World Championship', '5-8', '2024-10-19', 100125, null),
  r('2025 First Stand Tournament', '3-4', '2025-03-15', 172500, 'bronze'),
  r('LPL 2025 Split 1', 1, '2025-03-01', 41187, 'gold'),
  r('LPL 2025 Split 2', '5-6', '2025-06-08', 13924, null),
  r('LPL 2025 Split 3', 2, '2025-09-21', 168696, 'silver'),
  r('2025 World Championship', '3-4', '2025-11-02', 400000, 'bronze'),
  r('LPL 2026 Split 1', '5-6', '2026-03-02', 7250, null),
]);

// === JD Gaming: additional results ===
addResults('JD Gaming', [
  r('NEST 2017', 2, '2017-11-19', 22658, 'silver'),
  r('Demacia Championship 2017', 4, '2018-01-06', 30839, null),
  r('LPL 2018 Summer', 3, '2018-09-12', 73153, 'bronze'),
  r('NEST 2018', 1, '2018-11-18', 57711, 'gold'),
  r('LPL 2019 Spring', 2, '2019-04-21', 119470, 'silver'),
  r('LPL 2020 Spring', 1, '2020-05-02', 283186, 'gold'),
  r('LPL 2020 Summer', 2, '2020-08-27', 145134, 'silver'),
  r('LPL 2022 Spring', 4, '2022-04-16', 46142, null),
  r('LPL 2022 Summer', 1, '2022-09-01', 289842, 'gold'),
]);

// === KT Rolster: 2012-2017 ===
addResults('KT Rolster', [
  r('OnGameNet Club Masters', 3, '2013-02-22', 3685, 'bronze'),
  r('LCK 2015 Spring', 5, '2015-05-02', 9287, null),
  r('LCK 2015 Summer', 2, '2015-08-29', 50971, 'silver'),
  r('2015 World Championship', '5-8', '2015-10-18', 75000, null),
  r('KeSPA Cup 2015', '3-4', '2015-11-13', 8639, 'bronze'),
  r('LCK 2016 Spring', 3, '2016-04-16', 26184, 'bronze'),
  r('LCK 2016 Summer', 2, '2016-08-20', 53725, 'silver'),
  r('KeSPA Cup 2016', '5-8', '2016-11-13', 4277, null),
  r('LCK 2017 Spring', 2, '2017-04-22', 52787, 'silver'),
  r('LCK 2017 Summer', 3, '2017-08-19', 26628, 'bronze'),
  r('KeSPA Cup 2017', 1, '2017-12-02', 36798, 'gold'),
]);

// === Weibo Gaming (Suning): 2017-2021 ===
addResults('Weibo Gaming', [
  r('LSPL Spring 2017', 1, '2017-04-20', 43615, 'gold'),
  r('LPL 2020 Summer', 3, '2020-08-25', 72567, 'bronze'),
  r('2020 World Championship', 2, '2020-10-31', 389375, 'silver'),
  r('NEST 2021', 1, '2021-11-21', 62625, 'gold'),
]);

// === LNG Esports ===
addResults('LNG Esports', [
  r('LPL 2021 Summer', 4, '2021-08-26', 46485, null),
  r('2021 World Championship', '12-13', '2021-10-18', 52844, null),
  r('LPL 2022 Spring', '5-6', '2022-03-30', 30761, null),
  r('LPL 2022 Summer', 4, '2022-08-25', 43476, null),
  r('LPL 2023 Spring', '5-6', '2023-04-04', 29117, null),
  r('LPL 2023 Summer', 2, '2023-08-05', 139575, 'silver'),
  r('Demacia Cup 2025', '3-4', '2026-01-01', 28597, 'bronze'),
]);

// === Hanwha Life Esports: additional ===
addResults('Hanwha Life Esports', [
  r('LCK 2018 Summer', 6, '2018-08-09', 8728, null),
]);

fs.writeFileSync('public/pro-teams.json', JSON.stringify(d, null, 2));
console.log('\nGespeichert!');

// Final top 20 check
const sorted = [...d.teams].sort((a, b) => b.totalPrizeMoney - a.totalPrizeMoney);
console.log('\n=== Top 20 ===');
sorted.slice(0, 20).forEach((t, i) => {
  const sum = t.results.reduce((s, r) => s + (r.prizeUSD || 0), 0);
  const gap = t.totalPrizeMoney - sum;
  const earliest = t.results[t.results.length - 1]?.date || '-';
  console.log(`${(i + 1).toString().padStart(2)}. ${t.name.padEnd(28)} $${t.totalPrizeMoney.toLocaleString('en-US').padStart(12)} | ${t.results.length.toString().padStart(3)} results | from ${earliest} | gap: $${gap.toLocaleString()}`);
});
