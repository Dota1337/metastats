'use client';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';

// Datenschutzerklaerung der Overwolf-App (Store-Eintrag verlinkt hierher).
// Stand App 0.8.3: was die App liest, was lokal bleibt, was gesendet wird.
// Die Fristen (48 h Pseudonym, 48 h Loeschung ohne Spielkennung, 30 Tage
// Server-Protokoll) stehen in scripts/aggregate-position-observations.mjs,
// scripts/backfill-companion-placements.mjs und
// infra/hetzner/journald-retention.conf — bei Aenderungen hier nachziehen.

const LINK = 'text-brand hover:underline';

export default function CompanionPrivacyPage() {
  const { t } = useI18n();
  const h2 = 'text-white text-base font-medium mb-2';

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-white text-2xl font-medium mb-1">{t('legal.companionPrivacy.title')}</h1>
        <p className="text-xs text-fg-secondary mb-6">{t('legal.companion.updated')}</p>

        <section className="bg-surface-base border border-border-subtle rounded-lg p-6 space-y-6 text-sm text-fg-secondary leading-relaxed">
          <div>
            <p>{t('legal.companionPrivacy.intro')}</p>
            <p className="mt-2"><a href="/datenschutz" className={LINK}>{t('legal.companionPrivacy.generalLink')}</a></p>
          </div>

          <div>
            <h2 className={h2}>{t('legal.privacy.controllerHeading')}</h2>
            <p>info@metastats.gg · <a href="/impressum" className={LINK}>{t('legal.imprint')}</a></p>
          </div>

          <div>
            <h2 className={h2}>{t('legal.companionPrivacy.readHeading')}</h2>
            <p>{t('legal.companionPrivacy.readText')}</p>
          </div>

          <div>
            <h2 className={h2}>{t('legal.companionPrivacy.localHeading')}</h2>
            <p>{t('legal.companionPrivacy.localText')}</p>
          </div>

          <div>
            <h2 className={h2}>{t('legal.companionPrivacy.sentHeading')}</h2>
            <h3 className="text-white text-sm font-medium mt-3 mb-1">{t('legal.companionPrivacy.boardHeading')}</h3>
            <p>{t('legal.companionPrivacy.boardText')}</p>
            <p className="mt-2">{t('legal.companionPrivacy.boardStorage')}</p>
            <h3 className="text-white text-sm font-medium mt-4 mb-1">{t('legal.companionPrivacy.profileHeading')}</h3>
            <p>{t('legal.companionPrivacy.profileText')}</p>
          </div>

          <div>
            <h2 className={h2}>{t('legal.privacy.processorsHeading')}</h2>
            <ul className="list-disc ml-5 space-y-1">
              <li>{t('legal.companionPrivacy.svcVercel')}</li>
              <li>{t('legal.companionPrivacy.svcSupabase')}</li>
              <li>{t('legal.companionPrivacy.svcHetzner')}</li>
              <li>{t('legal.companionPrivacy.svcRiot')}</li>
              <li>{t('legal.companionPrivacy.svcCdragon')}</li>
              <li>{t('legal.privacy.processorSentry')}</li>
              <li>
                {t('legal.companionPrivacy.svcOverwolf')}{' '}
                <a href="https://www.overwolf.com/legal/privacy/" className={LINK} target="_blank" rel="noopener noreferrer">overwolf.com/legal/privacy</a>
              </li>
            </ul>
          </div>

          <div>
            <h2 className={h2}>{t('legal.companionPrivacy.basisHeading')}</h2>
            <p>{t('legal.companionPrivacy.basisText')}</p>
          </div>

          <div>
            <h2 className={h2}>{t('legal.privacy.rightsHeading')}</h2>
            <p>{t('legal.privacy.rightsIntro')}</p>
            <ul className="list-disc ml-5 mt-2 space-y-1">
              <li>{t('legal.privacy.rightAccess')}</li>
              <li>{t('legal.privacy.rightRectify')}</li>
              <li>{t('legal.privacy.rightErase')}</li>
              <li>{t('legal.privacy.rightRestrict')}</li>
              <li>{t('legal.privacy.rightPortability')}</li>
              <li>{t('legal.companionPrivacy.rightObject')}</li>
              <li>{t('legal.privacy.rightComplain')}</li>
            </ul>
            <p className="mt-3">{t('legal.privacy.rightsContact')}</p>
          </div>

          <div>
            <h2 className={h2}>{t('legal.privacy.changesHeading')}</h2>
            <p>{t('legal.privacy.changesText')}</p>
            <p className="mt-2"><a href="/companion/terms" className={LINK}>{t('legal.companionPrivacy.termsLink')}</a></p>
          </div>
        </section>
      </div>
      <Footer />
    </main>
  );
}
