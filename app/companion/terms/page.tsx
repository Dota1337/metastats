import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'metastats.gg Companion · Nutzungsbedingungen',
  description: 'Nutzungsbedingungen der metastats.gg Companion App.',
};

export default function CompanionTermsPage() {
  return (
    <main className="min-h-screen bg-[#0e1525] text-[#cfd6dc]">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <a href="/tft" className="text-[#7B61FF] text-xs hover:underline">← zurück</a>
        <h1 className="text-white text-3xl font-medium mt-3 mb-6">Nutzungsbedingungen · Companion App</h1>

        <p className="text-sm text-[#a0b0c5] mb-6">Stand: 17. Mai 2026</p>

        <section className="space-y-4 text-sm leading-relaxed">
          <h2 className="text-white text-lg font-medium mt-6">1. Geltungsbereich</h2>
          <p>
            Diese Nutzungsbedingungen regeln die Verwendung der <strong>metastats.gg Companion</strong> Overwolf-App
            („App") in der jeweils aktuellen Version. Mit der Installation und Nutzung erkennst du diese Bedingungen an.
          </p>

          <h2 className="text-white text-lg font-medium mt-6">2. Funktionsumfang</h2>
          <p>
            Die App sammelt im Hintergrund anonyme Position- und Comp-Daten aus deinen TFT-Partien und sendet sie an die
            Backend-API von metastats.gg, um die dort öffentlich angezeigten Statistiken zu verbessern. Es gibt kein
            In-Game-Overlay mit Beratung und kein Anzeigen von Augment-Empfehlungen.
          </p>

          <h2 className="text-white text-lg font-medium mt-6">3. Beziehung zu Riot Games</h2>
          <p>
            Diese App wurde nicht von Riot Games entwickelt oder unterstützt und steht in keiner offiziellen Verbindung zu
            Riot. Sie nutzt ausschließlich die offizielle Overwolf-Plattform, die ihrerseits Vanguard-konform und durch Riot
            toleriert ist. Es wird kein Spielspeicher gelesen, keine Memory-Injection durchgeführt und kein Wettbewerbsvorteil
            zu Mitspielern verschafft.
          </p>

          <h2 className="text-white text-lg font-medium mt-6">4. Verpflichtung des Nutzers</h2>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>Du nutzt die App nur für eigene TFT-Spiele und verwendest die übermittelten Daten nicht zur Manipulation Dritter.</li>
            <li>Du verwendest keine veränderte Version der App und kombinierst sie nicht mit anderen Drittwerkzeugen, die Spielregeln verletzen.</li>
            <li>Du verstehst, dass die App jederzeit über den <em>Pausieren</em>-Schalter im Desktop-Fenster deaktiviert werden kann, falls du nicht möchtest, dass Daten gesendet werden.</li>
          </ul>

          <h2 className="text-white text-lg font-medium mt-6">5. Verfügbarkeit und Updates</h2>
          <p>
            Die App wird kostenlos zur Verfügung gestellt. Wir behalten uns vor, Updates auszurollen, Funktionen anzupassen
            oder die App ohne Vorankündigung einzustellen. Eine Verfügbarkeitsgarantie wird nicht gegeben.
          </p>

          <h2 className="text-white text-lg font-medium mt-6">6. Haftung</h2>
          <p>
            Wir haften nicht für mittelbare Schäden, die durch die Nutzung oder Nicht-Verfügbarkeit der App entstehen. Für
            Schäden aus grober Fahrlässigkeit oder Vorsatz haften wir gemäß den gesetzlichen Bestimmungen. Du nutzt die App
            auf eigenes Risiko hinsichtlich deiner Riot-Konto-Compliance — soweit ersichtlich ist die App
            Vanguard-konform und mit Riot's 3rd-Party-Policy vereinbar.
          </p>

          <h2 className="text-white text-lg font-medium mt-6">7. Datenschutz</h2>
          <p>
            Welche Daten die App erhebt und wie sie verarbeitet werden, regelt die separate{' '}
            <a href="/companion/privacy" className="text-[#7B61FF] hover:underline">Datenschutzerklärung</a>.
          </p>

          <h2 className="text-white text-lg font-medium mt-6">8. Schlussbestimmungen</h2>
          <p>
            Es gilt das Recht der Bundesrepublik Deutschland. Sollten einzelne Klauseln dieser Bedingungen unwirksam sein,
            bleibt die Wirksamkeit der übrigen Klauseln davon unberührt.
          </p>
        </section>
      </div>
    </main>
  );
}
