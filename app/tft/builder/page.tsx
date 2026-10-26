import { builderStart } from '../../lib/seo/page-start-tft';
import BuilderClient from './BuilderClient';

// Server-Huelle des Team-Builders (Soft-404-Plan 26.10.2026): der Champion-Pool
// des laufenden Sets im ersten HTML, aus dem Bundle. Items und Pflanzen kommen
// wie bisher mit dem vollen Bundle im Browser. Titel/Beschreibung: layout.tsx.
export default function Page() {
  return <BuilderClient initialAssets={builderStart()} />;
}
