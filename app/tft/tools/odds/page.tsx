// Server-Huelle fuer den Roll-Rechner.
//
// Einziger Zweck: die Zahl der verschiedenen Shop-Einheiten je Kostenstufe
// einmal zur Bauzeit aus dem Asset-Bundle ableiten und als Eigenschaft
// weiterreichen. Das Bundle ist ~2,1 MB (`wc -c public/tft-assets.json` =
// 2.120.330 am 2026-09-25) und hat im Browser-Paket nichts verloren; die
// Rechenlogik und die gesamte Oberflaeche liegen deshalb in OddsCalculator.tsx.

import { readUniqueChampsPerCost } from '../../../lib/tft-shop-pool';
import OddsCalculator from './OddsCalculator';

export default function TftRollOddsPage() {
  const uniqueChamps = readUniqueChampsPerCost();
  return <OddsCalculator uniqueChamps={uniqueChamps} />;
}
