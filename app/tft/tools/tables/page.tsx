// Server-Huelle fuer die Tabellen-Seite: liest Loot-Tabellen und Wisps zur
// Bauzeit aus public/ (siehe app/lib/tft-loot-tables.ts) und reicht sie an
// die Oberflaeche weiter. Bilder loest der Client ueber tftGameAssetUrl auf,
// das Asset-Bundle bleibt aus dem Browser-Paket.

import { readLootTables, readWisps } from '../../../lib/tft-loot-tables';
import TablesView from './TablesView';

export default function TftTablesPage() {
  return <TablesView loot={readLootTables()} wisps={readWisps()} />;
}
