'use client';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import { useI18n } from '../lib/i18n';

// Impressum (TMG §5 + RStV §55 Abs. 2). German legal requirement for any
// public site operated from Germany. Content is static and content-only —
// no interactivity beyond the language switch in the global nav.

export default function ImpressumPage() {
  const { t } = useI18n();

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-white text-2xl font-medium mb-6">{t('legal.imprint')}</h1>

        <section className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-6 space-y-5 text-sm text-[#8a9bb0] leading-relaxed">
          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.imprint.providerHeading')}</h2>
            <p>metastats.gg</p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.imprint.contactHeading')}</h2>
            <p>E-Mail: info@metastats.gg</p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.imprint.responsibleHeading')}</h2>
            <p>{t('legal.imprint.responsibleText')}</p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.imprint.disclaimerHeading')}</h2>
            <p>{t('legal.imprint.disclaimerContent')}</p>
            <p className="mt-3">{t('legal.imprint.disclaimerLinks')}</p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.imprint.riotHeading')}</h2>
            <p>{t('legal.imprint.riotDisclaimer')}</p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.imprint.copyrightHeading')}</h2>
            <p>{t('legal.imprint.copyrightText')}</p>
          </div>
        </section>
      </div>
      <Footer />
    </main>
  );
}
