'use client';
import Nav from '../components/Nav';
import Footer from '../components/Footer';

export default function Impressum() {
  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav />

      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-white text-2xl font-medium mb-8">Impressum</h1>

        <div className="space-y-8">
          <section className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6">
            <h2 className="text-[#c89b3c] text-lg font-medium mb-3">Angaben gemäß § 5 TMG</h2>
            <div className="text-[#8a9bb0] text-sm leading-relaxed space-y-1">
              <p className="text-white font-medium">[Name des Betreibers]</p>
              <p>[Straße und Hausnummer]</p>
              <p>[PLZ und Ort]</p>
              <p>[Land]</p>
            </div>
          </section>

          <section className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6">
            <h2 className="text-[#c89b3c] text-lg font-medium mb-3">Kontakt</h2>
            <div className="text-[#8a9bb0] text-sm leading-relaxed space-y-1">
              <p>E-Mail: <span className="text-white">[E-Mail-Adresse]</span></p>
            </div>
          </section>

          <section className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6">
            <h2 className="text-[#c89b3c] text-lg font-medium mb-3">Haftungsausschluss</h2>
            <h3 className="text-white text-sm font-medium mb-2">Haftung für Links</h3>
            <p className="text-[#8a9bb0] text-sm leading-relaxed mb-4">
              Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen
              Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen.
              Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der
              Seiten verantwortlich. Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf
              mögliche Rechtsverstöße überprüft. Rechtswidrige Inhalte waren zum Zeitpunkt der
              Verlinkung nicht erkennbar. Eine permanente inhaltliche Kontrolle der verlinkten Seiten
              ist jedoch ohne konkrete Anhaltspunkte einer Rechtsverletzung nicht zumutbar. Bei
              Bekanntwerden von Rechtsverletzungen werden wir derartige Links umgehend entfernen.
            </p>
            <h3 className="text-white text-sm font-medium mb-2">Haftung für Inhalte</h3>
            <p className="text-[#8a9bb0] text-sm leading-relaxed">
              Die Inhalte unserer Seiten wurden mit größter Sorgfalt erstellt. Für die Richtigkeit,
              Vollständigkeit und Aktualität der Inhalte können wir jedoch keine Gewähr übernehmen.
              Alle angezeigten Spielstatistiken und Marktwerte basieren auf öffentlich verfügbaren
              Daten der Riot Games API und eigenen Berechnungen. Sie stellen keine verbindlichen
              Bewertungen dar.
            </p>
          </section>

          <section className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6">
            <h2 className="text-[#c89b3c] text-lg font-medium mb-3">Riot Games Hinweis</h2>
            <p className="text-[#8a9bb0] text-sm leading-relaxed mb-3">
              metastats.gg ist nicht offiziell mit Riot Games verbunden.
            </p>
            <p className="text-[#8a9bb0] text-sm leading-relaxed">
              metastats.gg is not endorsed by Riot Games and does not reflect the views or opinions
              of Riot Games or anyone officially involved in producing or managing Riot Games properties.
              Riot Games and all associated properties are trademarks or registered trademarks of
              Riot Games, Inc.
            </p>
          </section>
        </div>

        <Footer />
      </div>
    </main>
  );
}
