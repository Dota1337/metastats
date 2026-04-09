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
  console.log(`${teamName}: +${added} results, total ${team.results.length}, trophies ${team.trophies.length}`);
  console.log(`  Earliest: ${team.results[team.results.length - 1]?.event} (${team.results[team.results.length - 1]?.date})`);
}

// T1: SKT T1 era 2012-2019
addResults('T1', [
  { event: 'IEM Season VII Cologne', place: 1, date: '2012-12-16', prizeUSD: 15500, originalPrize: '15500 USD', trophy: 'gold' },
  { event: 'Champions 2013 Spring', place: 3, date: '2013-06-05', prizeUSD: 21258, originalPrize: '21258 USD', trophy: 'bronze' },
  { event: 'Champions 2013 Summer', place: 1, date: '2013-08-31', prizeUSD: 72076, originalPrize: '72076 USD', trophy: 'gold' },
  { event: 'Season 3 World Championship', place: 1, date: '2013-10-05', prizeUSD: 1000000, originalPrize: '1000000 USD', trophy: 'gold' },
  { event: 'Champions 2013-2014 Winter', place: 1, date: '2014-01-25', prizeUSD: 74582, originalPrize: '74582 USD', trophy: 'gold' },
  { event: 'NLB Spring 2014', place: 3, date: '2014-05-14', prizeUSD: 1953, originalPrize: '1953 USD', trophy: 'bronze' },
  { event: 'All-Star Paris 2014', place: 1, date: '2014-05-11', prizeUSD: 50000, originalPrize: '50000 USD', trophy: 'gold' },
  { event: 'Champions 2014 Summer', place: 4, date: '2014-08-06', prizeUSD: 17661, originalPrize: '17661 USD', trophy: null },
  { event: 'NLB Summer 2014', place: 1, date: '2014-08-09', prizeUSD: 4826, originalPrize: '4826 USD', trophy: 'gold' },
  { event: 'LCK 2015 Spring', place: 1, date: '2015-05-02', prizeUSD: 92868, originalPrize: '92868 USD', trophy: 'gold' },
  { event: '2015 Mid-Season Invitational', place: 2, date: '2015-05-10', prizeUSD: 50000, originalPrize: '50000 USD', trophy: 'silver' },
  { event: 'LCK 2015 Summer', place: 1, date: '2015-08-29', prizeUSD: 84951, originalPrize: '84951 USD', trophy: 'gold' },
  { event: '2015 World Championship', place: 1, date: '2015-10-31', prizeUSD: 1000000, originalPrize: '1000000 USD', trophy: 'gold' },
  { event: 'KeSPA Cup 2015', place: '3-4', date: '2015-11-13', prizeUSD: 8639, originalPrize: '8639 USD', trophy: 'bronze' },
  { event: 'IEM Season X World Championship', place: 1, date: '2016-03-06', prizeUSD: 50000, originalPrize: '50000 USD', trophy: 'gold' },
  { event: 'LCK 2016 Spring', place: 6, date: '2016-04-23', prizeUSD: 8728, originalPrize: '8728 USD', trophy: null },
  { event: '2016 Mid-Season Invitational', place: 1, date: '2016-05-15', prizeUSD: 250000, originalPrize: '250000 USD', trophy: 'gold' },
  { event: 'LCK 2016 Summer', place: 3, date: '2016-08-12', prizeUSD: 26862, originalPrize: '26862 USD', trophy: 'bronze' },
  { event: '2016 World Championship', place: 1, date: '2016-10-29', prizeUSD: 2028000, originalPrize: '2028000 USD', trophy: 'gold' },
  { event: 'KeSPA Cup 2016', place: '3-4', date: '2016-11-18', prizeUSD: 8554, originalPrize: '8554 USD', trophy: 'bronze' },
  { event: 'LCK 2017 Spring', place: 1, date: '2017-04-22', prizeUSD: 87979, originalPrize: '87979 USD', trophy: 'gold' },
  { event: '2017 Mid-Season Invitational', place: 1, date: '2017-05-21', prizeUSD: 676000, originalPrize: '676000 USD', trophy: 'gold' },
  { event: 'LCK 2017 Summer', place: 2, date: '2017-08-26', prizeUSD: 53255, originalPrize: '53255 USD', trophy: 'silver' },
  { event: '2017 World Championship', place: 2, date: '2017-11-04', prizeUSD: 667841, originalPrize: '667841 USD', trophy: 'silver' },
  { event: 'KeSPA Cup 2017', place: '3-4', date: '2017-12-01', prizeUSD: 9200, originalPrize: '9200 USD', trophy: 'bronze' },
  { event: 'LCK 2018 Spring', place: 4, date: '2018-04-04', prizeUSD: 18697, originalPrize: '18697 USD', trophy: null },
  { event: 'LCK 2018 Summer', place: 7, date: '2018-08-09', prizeUSD: 8893, originalPrize: '8893 USD', trophy: null },
  { event: 'KeSPA Cup 2018', place: '5-8', date: '2018-12-27', prizeUSD: 4490, originalPrize: '4490 USD', trophy: null },
  { event: 'LCK 2019 Spring', place: 1, date: '2019-04-13', prizeUSD: 87655, originalPrize: '87655 USD', trophy: 'gold' },
  { event: '2019 Mid-Season Invitational', place: '3-4', date: '2019-05-18', prizeUSD: 100000, originalPrize: '100000 USD', trophy: 'bronze' },
  { event: 'LCK 2019 Summer', place: 1, date: '2019-08-31', prizeUSD: 82874, originalPrize: '82874 USD', trophy: 'gold' },
  { event: '2019 World Championship', place: '3-4', date: '2019-11-03', prizeUSD: 155750, originalPrize: '155750 USD', trophy: 'bronze' },
]);

// Dplus KIA: DAMWON era 2017-2022
addResults('Dplus KIA', [
  { event: 'CK Summer 2017', place: 5, date: '2017-08-14', prizeUSD: 3571, originalPrize: '3571 USD', trophy: null },
  { event: 'CK Summer 2018', place: 1, date: '2018-08-27', prizeUSD: 17787, originalPrize: '17787 USD', trophy: 'gold' },
  { event: 'KeSPA Cup 2018', place: '3-4', date: '2018-12-29', prizeUSD: 8981, originalPrize: '8981 USD', trophy: 'bronze' },
  { event: 'LCK 2019 Spring', place: 4, date: '2019-04-05', prizeUSD: 17531, originalPrize: '17531 USD', trophy: null },
  { event: 'LCK 2019 Summer', place: 3, date: '2019-08-25', prizeUSD: 24862, originalPrize: '24862 USD', trophy: 'bronze' },
  { event: '2019 World Championship', place: '5-8', date: '2019-10-27', prizeUSD: 89000, originalPrize: '89000 USD', trophy: null },
  { event: 'KeSPA Cup 2019', place: '5-8', date: '2019-12-31', prizeUSD: 4326, originalPrize: '4326 USD', trophy: null },
  { event: 'LCK 2020 Spring', place: 4, date: '2020-04-20', prizeUSD: 16239, originalPrize: '16239 USD', trophy: null },
  { event: '2020 Mid-Season Cup', place: '5-6', date: '2020-05-31', prizeUSD: 40000, originalPrize: '40000 USD', trophy: null },
  { event: 'LCK 2020 Summer', place: 1, date: '2020-09-05', prizeUSD: 84216, originalPrize: '84216 USD', trophy: 'gold' },
  { event: '2020 World Championship', place: 1, date: '2020-10-31', prizeUSD: 556250, originalPrize: '556250 USD', trophy: 'gold' },
  { event: 'KeSPA Cup 2020', place: 1, date: '2021-01-02', prizeUSD: 36842, originalPrize: '36842 USD', trophy: 'gold' },
  { event: 'LCK 2021 Spring', place: 1, date: '2021-04-10', prizeUSD: 178412, originalPrize: '178412 USD', trophy: 'gold' },
  { event: '2021 Mid-Season Invitational', place: 2, date: '2021-05-23', prizeUSD: 50000, originalPrize: '50000 USD', trophy: 'silver' },
  { event: 'LCK 2021 Summer', place: 1, date: '2021-08-28', prizeUSD: 172068, originalPrize: '172068 USD', trophy: 'gold' },
  { event: '2021 World Championship', place: 2, date: '2021-11-06', prizeUSD: 333750, originalPrize: '333750 USD', trophy: 'silver' },
  { event: 'LCK 2022 Spring', place: 3, date: '2022-03-27', prizeUSD: 40991, originalPrize: '40991 USD', trophy: 'bronze' },
  { event: 'LCK 2022 Summer', place: 4, date: '2022-08-21', prizeUSD: 18626, originalPrize: '18626 USD', trophy: null },
  { event: '2022 World Championship', place: '5-8', date: '2022-10-22', prizeUSD: 100125, originalPrize: '100125 USD', trophy: null },
  { event: '2023 World Championship', place: '9-11', date: '2023-11-19', prizeUSD: 72313, originalPrize: '72313 USD', trophy: null },
]);

// Gen.G: Samsung Galaxy era 2013-2017
addResults('Gen.G', [
  { event: '2013 World Championship', place: '9-10', date: '2013-09-21', prizeUSD: 45000, originalPrize: '45000 USD', trophy: null },
  { event: 'Champions 2014 Spring', place: 1, date: '2014-05-24', prizeUSD: 78140, originalPrize: '78140 USD', trophy: 'gold' },
  { event: '2014 World Championship', place: 1, date: '2014-10-19', prizeUSD: 1000000, originalPrize: '1000000 USD', trophy: 'gold' },
  { event: 'LCK 2016 Summer', place: 4, date: '2016-08-10', prizeUSD: 17908, originalPrize: '17908 USD', trophy: null },
  { event: '2016 World Championship', place: 2, date: '2016-10-29', prizeUSD: 760500, originalPrize: '760500 USD', trophy: 'silver' },
  { event: 'KeSPA Cup 2016', place: '5-8', date: '2016-11-13', prizeUSD: 4277, originalPrize: '4277 USD', trophy: null },
  { event: 'IEM Season XI Gyeonggi', place: 1, date: '2016-12-18', prizeUSD: 50000, originalPrize: '50000 USD', trophy: 'gold' },
  { event: 'LCK 2017 Spring', place: 3, date: '2017-04-15', prizeUSD: 26394, originalPrize: '26394 USD', trophy: 'bronze' },
  { event: 'LCK 2017 Summer', place: 4, date: '2017-08-15', prizeUSD: 17752, originalPrize: '17752 USD', trophy: null },
  { event: '2017 World Championship', place: 1, date: '2017-11-04', prizeUSD: 1855114, originalPrize: '1855114 USD', trophy: 'gold' },
  { event: 'KeSPA Cup 2017', place: '3-4', date: '2017-12-01', prizeUSD: 9200, originalPrize: '9200 USD', trophy: 'bronze' },
  { event: 'LCK 2018 Spring', place: 5, date: '2018-03-31', prizeUSD: 14023, originalPrize: '14023 USD', trophy: null },
]);

fs.writeFileSync('public/pro-teams.json', JSON.stringify(d, null, 2));
console.log('\nGespeichert!');
