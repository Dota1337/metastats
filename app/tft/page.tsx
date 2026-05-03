'use client';
import { useState, useEffect } from 'react';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import { useI18n } from '../lib/i18n';
import { loadTftSetMeta } from '../lib/tft-dd-assets';

export default function TftLandingPage() {
  const { t } = useI18n();
  const [setLabel, setSetLabel] = useState<string>('Teamfight Tactics');

  useEffect(() => {
    loadTftSetMeta().then(meta => {
      if (meta) setSetLabel(`Set ${meta.setNumber} · ${meta.setName}`);
    });
  }, []);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="search" />
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-8 text-center">
          <div className="inline-block px-3 py-1 rounded-full bg-[#7B61FF]/15 text-[#7B61FF] text-xs uppercase tracking-widest mb-4">
            {setLabel}
          </div>
          <h1 className="text-white text-2xl font-medium mb-2">Teamfight Tactics</h1>
          <p className="text-[#8a9bb0] text-sm">{t('home.subtitle')}</p>
          <p className="text-[#4a5a70] text-xs mt-6">Wir bauen die TFT-Sektion gerade auf — kommt in Kürze.</p>
        </div>
      </div>
      <Footer />
    </main>
  );
}
