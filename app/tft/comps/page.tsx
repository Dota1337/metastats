'use client';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import CompList from '../../components/tft/CompList';
import TftHero from '../../components/tft/TftHero';
import { useI18n } from '../../lib/i18n';

// /tft/comps and /tft (landing) render the same comp tier list. Keeping
// both routes alive so deep-links and the Nav tab both work.
export default function TftCompsPage() {
  const { t } = useI18n();
  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <TftHero pageTitle={t('nav.comps')} subtitle={t('tft.heroSubtitle')} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <CompList headless />
      </div>
      <Footer />
    </main>
  );
}
