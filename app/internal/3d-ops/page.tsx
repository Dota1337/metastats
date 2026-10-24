import systemMap from '../../../infra/system-map.json';
import contracts from '../../../infra/contracts.json';
import { deriveTopology } from '../../lib/ops-topology';
import OpsGraphLoader from './OpsGraphLoader';

// Server-Komponente: leitet den Aufbau der Box (wer startet wen, wer schreibt
// wohin, wann laeuft was) aus den beiden erzeugten Karten ab und reicht nur
// diese schlanke Liste an den Graphen weiter. Die Karten selbst bleiben auf
// dem Server — im Browser-Bundle waeren das ~22 KB komprimiert, mit
// Server-Pfaden, in einer Datei ohne Anmeldung (_next/static).
export default function InternalOpsPage() {
  const topology = deriveTopology(systemMap, contracts.contracts);
  return <OpsGraphLoader topology={topology} />;
}
