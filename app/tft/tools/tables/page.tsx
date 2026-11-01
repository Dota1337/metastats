// Server-Huelle fuer die Tabellen-Seite: liest Loot-Tabellen und Wisps aus
// public/ (siehe app/lib/tft-loot-tables.ts) und reicht sie an die Oberflaeche
// weiter. Bilder loest der Client ueber tftGameAssetUrl auf, das Asset-Bundle
// bleibt aus dem Browser-Paket: von ihm kommen nur die Namen der Tabellen-Eintraege.

import { readLootTables, readWisps } from '../../../lib/tft-loot-tables';
import { lootTableNames } from '../../../lib/tft-loot-names';
import { tftAssets } from '../../../lib/og/data';
import TablesView from './TablesView';

export default function TftTablesPage() {
  const loot = readLootTables();
  return <TablesView loot={loot} wisps={readWisps()} names={lootTableNames(loot, tftAssets(), loot?.coven.name)} />;
}
