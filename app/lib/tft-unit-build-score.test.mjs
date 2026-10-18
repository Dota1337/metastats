import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreItems, scoreBuilds, buildsWithCount, placeChange, MIN_TIER_GAMES } from "./tft-unit-build-score.ts";

// Echte MetaTFT-Rohdaten (Lux, Platin+, 3 Tage, Units mit genau 3 Items; abgerufen
// 19.10.2026), Erwartung aus deren Rechenweg (Units-*.js), der 100 von 100 Zeilen
// ihrer Seite trifft. Item-Namen anonymisiert. Spalten: key, games, avg, half, pc, tier.
const REF = {"games":332135,"avg":3.5394};
const MAX_ITEM_GAMES = 187213;
const ITEMS = [
  ["I9",33262,3.1944,0.0232,-0.3682,"S"],
  ["I8",35020,3.2425,0.0228,-0.317,"S"],
  ["I12",24460,3.2552,0.027,-0.2891,"S"],
  ["I5",56043,3.368,0.0184,-0.1941,"S"],
  ["I3",72550,3.4095,0.0163,-0.1555,"S"],
  ["I4",67925,3.4646,0.0169,-0.083,"S"],
  ["I6",50168,3.4768,0.0194,-0.0611,"A"],
  ["I10",32598,3.4726,0.0244,-0.0581,"A"],
  ["I11",29425,3.489,0.0256,-0.0386,"A"],
  ["I7",41694,3.5387,0.0218,0.0134,"A"],
  ["I18",10523,3.1984,0.0421,-0.3246,"A"],
  ["I16",12034,3.2884,0.04,-0.2342,"A"],
  ["I13",20640,3.5331,0.0311,0.0136,"B"],
  ["I20",6235,3.3071,0.0591,-0.1981,"B"],
  ["I2",150416,3.6756,0.0117,0.2566,"B"],
  ["I22",5780,3.3519,0.0574,-0.1533,"B"],
  ["I21",6002,3.3692,0.0549,-0.1374,"B"],
  ["I24",4492,3.2727,0.0695,-0.2249,"C"],
  ["I19",7198,3.4601,0.0562,-0.0443,"C"],
  ["I1",187213,3.6814,0.0105,0.3323,"C"],
  ["I35",2445,3.1648,0.0811,-0.3243,"C"],
  ["I15",13323,3.7108,0.0412,0.2055,"C"],
  ["I36",2307,3.1764,0.0865,-0.3089,"C"],
  ["I43",1869,3.0599,0.1045,-0.4138,"C"],
  ["I32",2807,3.2854,0.0803,-0.2037,"C"],
  ["I14",19663,3.7902,0.032,0.2875,"C"],
  ["I25",4063,3.4573,0.0686,-0.0382,"C"],
  ["I51",1273,2.8932,0.1114,-0.5758,"C"],
  ["I41",2031,3.2418,0.0925,-0.239,"C"],
  ["I47",1389,3.0727,0.1116,-0.3956,"C"],
  ["I39",2053,3.3468,0.104,-0.1257,"C"],
  ["I54",1206,3.1086,0.1167,-0.356,"C"],
  ["I27",3960,3.6225,0.0697,0.1297,"C"],
  ["I45",1569,3.3391,0.1088,-0.1301,"C"],
  ["I28",3902,3.6889,0.0735,0.1994,"C"],
  ["I30",3266,3.6598,0.0794,0.1736,"C"],
  ["I40",2037,3.5503,0.1013,0.0773,"C"],
  ["I55",1169,3.4115,0.1358,-0.0395,"D"],
  ["I48",1366,3.4839,0.1199,0.0227,"D"],
  ["I44",1813,3.583,0.1025,0.1109,"D"],
  ["I56",1129,3.4535,0.1409,0.006,"D"],
  ["I17",11306,3.8788,0.0431,0.3796,"D"],
  ["I57",1057,3.4863,0.1479,0.0434,"D"],
  ["I38",2079,3.6676,0.1059,0.1983,"D"],
  ["I50",1307,3.6656,0.1228,0.207,"D"],
  ["I42",1898,3.7972,0.1051,0.328,"D"],
  ["I33",2537,3.8613,0.0908,0.3838,"D"],
  ["I53",1222,3.7962,0.1232,0.3384,"D"],
  ["I52",1244,3.8047,0.1297,0.3511,"D"],
  ["I46",1484,3.8282,0.1177,0.367,"D"],
  ["I34",2519,3.9631,0.0897,0.4856,"D"],
  ["I29",3738,3.9928,0.0757,0.508,"D"],
  ["I31",2871,4.0313,0.0872,0.5533,"D"],
  ["I26",3974,4.032,0.0734,0.5466,"D"],
  ["I49",1330,4.2579,0.1271,0.8045,"D"],
  ["I37",2242,4.4309,0.0986,0.962,"D"],
  ["I23",5402,4.2751,0.0635,0.7894,"D"],
];
// Die 30 bestbewerteten Builds (das Strecken der Stufen haengt nur an den besten 3).
const BUILDS = [
  ["I67|I60|I62",4191,3.1916,0.0661,-0.309,"S"],
  ["I70|I60|I62",1595,2.9994,0.1014,-0.4763,"S"],
  ["I59|I60|I62",3112,3.3772,0.0783,-0.1124,"S"],
  ["I64|I58|I59",4196,3.4576,0.0689,-0.0378,"A"],
  ["I63|I59|I60",2580,3.4233,0.0842,-0.062,"A"],
  ["I64|I67|I62",759,2.7931,0.1407,-0.6559,"A"],
  ["I58|I67|I60",2951,3.4924,0.081,0.0055,"A"],
  ["I67|I59|I60",1370,3.1839,0.1138,-0.2825,"A"],
  ["I58|I59|I60",11465,3.6034,0.0419,0.0937,"A"],
  ["I58|I70|I60",2644,3.5204,0.0849,0.0364,"B"],
  ["I63|I64|I59",902,3.071,0.134,-0.3821,"B"],
  ["I64|I59|I62",899,3.0834,0.1379,-0.367,"B"],
  ["I59|I70|I60",1220,3.2443,0.1238,-0.2152,"B"],
  ["I69|I59|I60",1478,3.3376,0.1151,-0.1274,"B"],
  ["I74|I59|I60",894,3.1119,0.1403,-0.3369,"B"],
  ["I69|I67|I62",566,2.8286,0.1711,-0.6,"B"],
  ["I66|I59|I60",1572,3.3842,0.1097,-0.0842,"B"],
  ["I63|I60|I62",1769,3.4319,0.1015,-0.0417,"B"],
  ["I58|I61|I59",1334,3.3366,0.1209,-0.1246,"B"],
  ["I58|I61|I65",882,3.1667,0.146,-0.2782,"B"],
  ["I69|I58|I59",942,3.2028,0.1384,-0.2471,"B"],
  ["I64|I59|I60",2379,3.5708,0.0902,0.0906,"B"],
  ["I64|I58|I62",1947,3.5177,0.0997,0.0434,"B"],
  ["I69|I58|I60",3241,3.6538,0.0785,0.1669,"B"],
  ["I64|I58|I67",1010,3.2832,0.1352,-0.1686,"B"],
  ["I63|I67|I60",918,3.2484,0.1376,-0.2019,"B"],
  ["I63|I64|I58",2121,3.5535,0.094,0.0757,"B"],
  ["I69|I60|I62",821,3.1973,0.1464,-0.2472,"B"],
  ["I68|I59|I60",1409,3.4386,0.1145,-0.0263,"B"],
  ["I64|I58|I65",1254,3.3979,0.1258,-0.0597,"B"],
];
const rows = (list) => list.map(([key, games, avg, half]) => ({ key, games, avg, half }));

test("Items: Reihenfolge, Place Change und Stufe wie MetaTFT", () => {
  const got = scoreItems(rows(ITEMS), REF);
  assert.deepEqual(got.map(s => s.row.key), ITEMS.map(r => r[0]));
  got.forEach((s, i) => {
    assert.ok(Math.abs(s.pc - ITEMS[i][4]) < 0.002, `${s.row.key} pc ${s.pc} != ${ITEMS[i][4]}`);
    assert.equal(s.tier, ITEMS[i][5], s.row.key);
  });
});

test("Builds: Reihenfolge, Place Change und Stufe wie MetaTFT", () => {
  const got = scoreBuilds(rows(BUILDS), REF, MAX_ITEM_GAMES);
  assert.deepEqual(got.map(s => s.row.key), BUILDS.map(r => r[0]));
  got.forEach((s, i) => {
    assert.ok(Math.abs(s.pc - BUILDS[i][4]) < 0.002, s.row.key);
    assert.equal(s.tier, BUILDS[i][5], s.row.key);
  });
});

test("Stufe erst ab MIN_TIER_GAMES Spielen, Strecken nur darunter", () => {
  const ref = { games: 1000, avg: 4 };
  const got = scoreBuilds([
    { key: "A|B|C", games: 7, avg: 1.5, half: 0.8 },
    { key: "A|B|D", games: 200, avg: 3.6, half: 0.25 },
    { key: "A|C|D", games: 150, avg: 3.8, half: 0.3 },
  ], ref, 400);
  const byKey = Object.fromEntries(got.map(s => [s.row.key, s.tier]));
  assert.equal(byKey["A|B|C"], null);
  assert.equal(byKey["A|B|D"], "S");
  assert.ok(MIN_TIER_GAMES === 30);
});

test("Diebeshandschuhe abgewertet, kleine Builds abgewertet", () => {
  const ref = { games: 10000, avg: 4 };
  const base = { games: 2000, avg: 3, half: 0.1 };
  const [tg] = scoreBuilds([{ key: "X_ThiefsGloves", ...base }], ref, 3000);
  const [full] = scoreBuilds([{ key: "A|B|C", ...base }], ref, 3000);
  const [two] = scoreBuilds([{ key: "A|B", ...base }], ref, 3000);
  assert.ok(full.score > two.score && two.score > tg.score);
});

test("Place Change ohne Rest (Zeile = alle Bretter) ist null", () => {
  assert.equal(placeChange({ key: "A", games: 10, avg: 4, half: 1 }, { games: 10, avg: 4 }), null);
});

test("buildsWithCount: nur Schluessel mit n Items, Diebeshandschuhe immer", () => {
  const list = [{ key: "A|B|C" }, { key: "A|B" }, { key: "X_ThiefsGloves" }, { key: "A" }];
  assert.deepEqual(buildsWithCount(list, 3).map(r => r.key), ["A|B|C", "X_ThiefsGloves"]);
  assert.deepEqual(buildsWithCount(list, null).length, 4);
});
