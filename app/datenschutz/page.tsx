'use client';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import { useI18n } from '../lib/i18n';

// Datenschutzerklärung — DSGVO Art. 13 + 14. Lists every personal data flow:
// what we collect, why, retention, third-party processors, and user rights.
// Content reflects the actual data flows in metastats.gg as of 2026-05-12:
//   * Spielersuche → Riot API (Account-Resolve, no PII stored beyond puuid)
//   * Match-Cache, Marktwert-Snapshots → Supabase (puuid + game data only)
//   * Sprach-Cookie (essential, no consent needed under TTDSG §25 Abs. 2)
//   * Vercel Analytics (hashed/anonymous — no IP, no third-party cookies)

export default function DatenschutzPage() {
  const { t } = useI18n();

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-white text-2xl font-medium mb-6">{t('legal.privacy')}</h1>

        <section className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-6 space-y-6 text-sm text-[#8a9bb0] leading-relaxed">
          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.overviewHeading')}</h2>
            <p>{t('legal.privacy.overviewText')}</p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.controllerHeading')}</h2>
            <p>info@metastats.gg</p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.dataCollectedHeading')}</h2>
            <p>{t('legal.privacy.dataCollectedIntro')}</p>
            <ul className="list-disc ml-5 mt-2 space-y-1">
              <li>{t('legal.privacy.dataRiot')}</li>
              <li>{t('legal.privacy.dataLogs')}</li>
              <li>{t('legal.privacy.dataLang')}</li>
            </ul>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.processorsHeading')}</h2>
            <ul className="list-disc ml-5 space-y-1">
              <li>{t('legal.privacy.processorVercel')}</li>
              <li>{t('legal.privacy.processorSupabase')}</li>
              <li>{t('legal.privacy.processorRiot')}</li>
              <li>{t('legal.privacy.processorCdragon')}</li>
            </ul>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.cookiesHeading')}</h2>
            <p>{t('legal.privacy.cookiesText')}</p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.retentionHeading')}</h2>
            <p>{t('legal.privacy.retentionText')}</p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.rightsHeading')}</h2>
            <p>{t('legal.privacy.rightsIntro')}</p>
            <ul className="list-disc ml-5 mt-2 space-y-1">
              <li>{t('legal.privacy.rightAccess')}</li>
              <li>{t('legal.privacy.rightRectify')}</li>
              <li>{t('legal.privacy.rightErase')}</li>
              <li>{t('legal.privacy.rightRestrict')}</li>
              <li>{t('legal.privacy.rightPortability')}</li>
              <li>{t('legal.privacy.rightComplain')}</li>
            </ul>
            <p className="mt-3">{t('legal.privacy.rightsContact')}</p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.changesHeading')}</h2>
            <p>{t('legal.privacy.changesText')}</p>
          </div>
        </section>
      </div>
      <Footer />
    </main>
  );
}
