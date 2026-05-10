'use client';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import CompList from '../components/tft/CompList';
import TftHero from '../components/tft/TftHero';
import { useI18n } from '../lib/i18n';

// /tft is the comp tier list — same as /tft/comps. We mirror MetaTFT's
// approach of putting comps front-and-center on the landing.
export default function TftLandingPage() {
  const { t } = useI18n();
  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <TftHero pageTitle={t('nav.comps')} subtitle={t('tft.heroSubtitle')} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-3 pb-6">
        <CompList headless />
      </div>
      <Footer />
    </main>
  );
}
