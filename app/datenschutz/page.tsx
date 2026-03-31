'use client';
import Nav from '../components/Nav';
import Footer from '../components/Footer';

export default function Datenschutz() {
  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav />

      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-white text-2xl font-medium mb-8">Datenschutzerklärung</h1>

        <div className="space-y-8">
          <section className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6">
            <h2 className="text-[#c89b3c] text-lg font-medium mb-3">1. Verantwortlicher</h2>
            <p className="text-[#8a9bb0] text-sm leading-relaxed">
              Verantwortlich für die Datenverarbeitung auf dieser Website ist der Betreiber von metastats.gg.
              Kontaktdaten entnehmen Sie bitte dem <a href="/impressum" className="text-[#c89b3c] hover:underline">Impressum</a>.
            </p>
          </section>

          <section className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6">
            <h2 className="text-[#c89b3c] text-lg font-medium mb-3">2. Datenerhebung auf dieser Website</h2>
            <p className="text-[#8a9bb0] text-sm leading-relaxed mb-3">
              Beim Besuch unserer Website werden automatisch technische Daten erfasst (z.&nbsp;B. Browsertyp,
              Betriebssystem, Uhrzeit des Zugriffs). Diese Daten werden anonymisiert erhoben und dienen
              ausschließlich der Sicherstellung eines störungsfreien Betriebs.
            </p>
            <p className="text-[#8a9bb0] text-sm leading-relaxed">
              Wenn Sie nach einem Spieler suchen, wird der eingegebene Spielername an die Riot Games API
              übermittelt und die zurückgegebenen Spielstatistiken angezeigt. Suchanfragen werden in
              anonymisierter Form gespeichert, um die Funktion „Zuletzt gesucht" bereitzustellen.
            </p>
          </section>

          <section className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6">
            <h2 className="text-[#c89b3c] text-lg font-medium mb-3">3. Cookies</h2>
            <p className="text-[#8a9bb0] text-sm leading-relaxed mb-3">
              Diese Website verwendet ein einziges Cookie:
            </p>
            <div className="bg-[#0e1525] border border-[#1e2a3a] rounded p-4 mb-3">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-[#4a5a70]">Name:</span>
                  <span className="text-white ml-2">visitor_id</span>
                </div>
                <div>
                  <span className="text-[#4a5a70]">Zweck:</span>
                  <span className="text-white ml-2">Zuletzt gesuchte Spieler</span>
                </div>
                <div>
                  <span className="text-[#4a5a70]">Dauer:</span>
                  <span className="text-white ml-2">1 Jahr</span>
                </div>
              </div>
            </div>
            <p className="text-[#8a9bb0] text-sm leading-relaxed">
              Das Cookie <code className="text-white bg-[#0e1525] px-1 rounded">visitor_id</code> enthält eine
              zufällig generierte ID, die ausschließlich dazu dient, Ihnen Ihre zuletzt gesuchten Spieler
              anzuzeigen. Es werden keine personenbezogenen Daten gespeichert.
            </p>
          </section>

          <section className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6">
            <h2 className="text-[#c89b3c] text-lg font-medium mb-3">4. Riot Games API</h2>
            <p className="text-[#8a9bb0] text-sm leading-relaxed mb-3">
              Diese Website nutzt die offizielle Riot Games API, um Spielerdaten wie Match History,
              Ranglistenpositionen, Champion Mastery und Live-Game-Informationen abzurufen. Die Daten
              werden direkt von Riot Games bereitgestellt.
            </p>
            <p className="text-[#8a9bb0] text-sm leading-relaxed">
              metastats.gg ist nicht von Riot Games unterstützt und spiegelt nicht die Ansichten oder
              Meinungen von Riot Games oder offiziell an der Produktion oder Verwaltung von
              League of Legends beteiligten Personen wider.
            </p>
          </section>

          <section className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6">
            <h2 className="text-[#c89b3c] text-lg font-medium mb-3">5. Supabase (Datenbank)</h2>
            <p className="text-[#8a9bb0] text-sm leading-relaxed">
              Wir verwenden Supabase als Datenbank-Service zur Speicherung anonymisierter Suchdaten und
              Marktwert-Berechnungen. Die Server befinden sich in der EU. Es werden keine
              personenbezogenen Daten in der Datenbank gespeichert.
            </p>
          </section>

          <section className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6">
            <h2 className="text-[#c89b3c] text-lg font-medium mb-3">6. Rechte der Nutzer</h2>
            <p className="text-[#8a9bb0] text-sm leading-relaxed mb-3">
              Gemäß der DSGVO haben Sie folgende Rechte:
            </p>
            <ul className="text-[#8a9bb0] text-sm leading-relaxed list-disc list-inside space-y-1">
              <li>Recht auf Auskunft über Ihre gespeicherten Daten (Art. 15 DSGVO)</li>
              <li>Recht auf Berichtigung unrichtiger Daten (Art. 16 DSGVO)</li>
              <li>Recht auf Löschung Ihrer Daten (Art. 17 DSGVO)</li>
              <li>Recht auf Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
              <li>Recht auf Datenübertragbarkeit (Art. 20 DSGVO)</li>
              <li>Widerspruchsrecht gegen die Verarbeitung (Art. 21 DSGVO)</li>
            </ul>
          </section>

          <section className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6">
            <h2 className="text-[#c89b3c] text-lg font-medium mb-3">7. Kontakt</h2>
            <p className="text-[#8a9bb0] text-sm leading-relaxed">
              Bei Fragen zum Datenschutz können Sie uns jederzeit über die im{' '}
              <a href="/impressum" className="text-[#c89b3c] hover:underline">Impressum</a>{' '}
              angegebenen Kontaktdaten erreichen.
            </p>
          </section>
        </div>

        <Footer />
      </div>
    </main>
  );
}
