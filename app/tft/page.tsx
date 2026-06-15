'use client';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import CompList from '../components/tft/CompList';
import TftHero from '../components/tft/TftHero';
import TwitchLiveStrip from '../components/tft/TwitchLiveStrip';
import { useI18n } from '../lib/i18n';

export default function TftLandingPage() {
  const { t } = useI18n();
  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <TftHero pageTitle={t('nav.comps')} subtitle={t('tft.heroSubtitle')} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <TwitchLiveStrip first={8} />
        <CompList headless />
      </div>
      <Footer />
    </main>
  );
}
