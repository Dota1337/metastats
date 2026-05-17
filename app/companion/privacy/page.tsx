import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'metastats.gg Companion · Datenschutz',
  description: 'Datenschutzerklärung der metastats.gg Companion App (Overwolf).',
};

export default function CompanionPrivacyPage() {
  return (
    <main className="min-h-screen bg-[#0e1525] text-[#cfd6dc]">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <a href="/tft" className="text-[#7B61FF] text-xs hover:underline">← zurück</a>
        <h1 className="text-white text-3xl font-medium mt-3 mb-6">Datenschutz · Companion App</h1>

        <p className="text-sm text-[#a0b0c5] mb-6">Stand: 17. Mai 2026</p>

        <section className="space-y-4 text-sm leading-relaxed">
          <h2 className="text-white text-lg font-medium mt-6">1. Verantwortlich</h2>
          <p>
            Verantwortlich für die Verarbeitung der durch die <strong>metastats.gg Companion</strong> Overwolf-App
            erhobenen Daten ist Dominik Taubinger, Kontakt: <a href="mailto:d.taubinger@web.de" className="text-[#7B61FF] hover:underline">d.taubinger@web.de</a>. Weitere Angaben finden sich im <a href="/impressum" className="text-[#7B61FF] hover:underline">Impressum</a>.
          </p>

          <h2 className="text-white text-lg font-medium mt-6">2. Welche Daten verarbeitet die Companion App?</h2>
          <p>Die App läuft als stille Hintergrund-Telemetrie und erhebt während einer aktiven TFT-Partie:</p>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>Match-ID, Region und deine Endplatzierung</li>
            <li>Position deiner Einheiten auf dem Hex-Board (Cell-ID, Champion-Name, Star-Level, Item-Kombination)</li>
            <li>Sichtbare Position der Gegner-Einheiten in den Lobby-Kämpfen (gleiche Felder, anonymisiert)</li>
            <li>Welche Augments du im Match gewählt hast — diese Information wird nur statistisch ausgewertet, niemals dir oder anderen Nutzern angezeigt</li>
            <li>Deine Riot-PUUID als pseudonyme Kennung, damit eine Match-Session korrekt zusammengefasst wird</li>
            <li>Eine Versionsnummer der App (technische Diagnose)</li>
          </ul>

          <h2 className="text-white text-lg font-medium mt-6">3. Was die App NICHT erhebt</h2>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>Kein Lesen des Spiel-Arbeitsspeichers (Riot-Vanguard-konform)</li>
            <li>Keine personenbezogenen Daten außerhalb der Riot-PUUID</li>
            <li>Keine Geolokalisierung, kein Browserverlauf, keine Festplatten-Daten</li>
            <li>Keine Tracking-Cookies, keine Werbe-Identifier</li>
          </ul>

          <h2 className="text-white text-lg font-medium mt-6">4. Zweck der Verarbeitung</h2>
          <p>
            Die erhobenen Daten dienen ausschließlich der Berechnung anonymisierter Aggregat-Statistiken (Position-Heatmaps,
            Comp-Performance, Augment-Win-Rates), die auf <a href="https://metastats.gg" className="text-[#7B61FF] hover:underline">metastats.gg</a> öffentlich dargestellt werden. Es findet keine individuelle Auswertung statt; einzelne
            Match-Daten werden nicht an Dritte weitergegeben.
          </p>

          <h2 className="text-white text-lg font-medium mt-6">5. Rechtsgrundlage</h2>
          <p>
            Die Verarbeitung erfolgt auf Grundlage deiner Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), die du durch Installation
            der App erteilst. Über den im App-Fenster sichtbaren <em>Pausieren</em>-Schalter kannst du die Datensammlung
            jederzeit deaktivieren. Eine Deinstallation widerruft die Einwilligung vollständig.
          </p>

          <h2 className="text-white text-lg font-medium mt-6">6. Speicherort und Dauer</h2>
          <p>
            Die Daten werden auf Servern in der EU (Supabase, AWS Frankfurt sowie eine eigene Crawler-Box bei Hetzner in
            Helsinki) gespeichert. Aggregierte Statistiken bleiben unbegrenzt erhalten; rohe Einzel-Match-Beobachtungen
            werden spätestens nach <strong>90 Tagen</strong> automatisch gelöscht oder anonymisiert.
          </p>

          <h2 className="text-white text-lg font-medium mt-6">7. Empfänger</h2>
          <p>Empfänger der Daten ist ausschließlich der Betreiber dieser Seite. Es werden keine Daten an Werbenetzwerke,
            Analyse-Plattformen oder Riot Games übermittelt — über die durch Overwolf bereits selbst erhobenen
            Telemetrie-Daten gemäß deren eigener Datenschutzerklärung hinaus.</p>

          <h2 className="text-white text-lg font-medium mt-6">8. Deine Rechte</h2>
          <p>Du hast jederzeit das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung sowie Datenübertragbarkeit
            deiner Daten. Sende dazu eine Email an <a href="mailto:d.taubinger@web.de" className="text-[#7B61FF] hover:underline">d.taubinger@web.de</a> unter Angabe deiner Riot-PUUID.
            Du hast außerdem das Recht, dich bei einer Aufsichtsbehörde zu beschweren.</p>

          <h2 className="text-white text-lg font-medium mt-6">9. Overwolf-Plattform</h2>
          <p>
            Die App nutzt die offizielle Overwolf-Plattform zur Datenerfassung. Es gelten zusätzlich die
            Datenschutzbestimmungen von Overwolf:{' '}
            <a href="https://www.overwolf.com/legal/privacy/" className="text-[#7B61FF] hover:underline" target="_blank" rel="noopener noreferrer">www.overwolf.com/legal/privacy/</a>.
          </p>

          <h2 className="text-white text-lg font-medium mt-6">10. Änderungen</h2>
          <p>Wir behalten uns vor, diese Erklärung anzupassen, sobald sich Funktionsumfang oder rechtliche Anforderungen
            ändern. Die jeweils aktuelle Fassung ist auf dieser Seite einsehbar.</p>
        </section>
      </div>
    </main>
  );
}
