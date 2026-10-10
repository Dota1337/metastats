'use client';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';

// Nutzungsbedingungen der Overwolf-App (Store-Eintrag verlinkt hierher).
// Funktionsumfang nach App 0.8.3: keine Augment-Daten, keine Gewinnchancen,
// keine Gegner-Comps im Spiel.

const LINK = 'text-brand hover:underline';

export default function CompanionTermsPage() {
  const { t } = useI18n();
  const h2 = 'text-white text-base font-medium mb-2';

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-white text-2xl font-medium mb-1">{t('legal.companionTerms.title')}</h1>
        <p className="text-xs text-fg-secondary mb-6">{t('legal.companion.updated')}</p>

        <section className="bg-surface-base border border-border-subtle rounded-lg p-6 space-y-6 text-sm text-fg-secondary leading-relaxed">
          <div>
            <h2 className={h2}>1. {t('legal.companionTerms.scopeHeading')}</h2>
            <p>{t('legal.companionTerms.scopeText')}</p>
          </div>

          <div>
            <h2 className={h2}>2. {t('legal.companionTerms.featuresHeading')}</h2>
            <p>{t('legal.companionTerms.featuresText')}</p>
          </div>

          <div>
            <h2 className={h2}>3. {t('legal.companionTerms.riotHeading')}</h2>
            <p>{t('legal.companionTerms.riotText')}</p>
          </div>

          <div>
            <h2 className={h2}>4. {t('legal.companionTerms.dutiesHeading')}</h2>
            <ul className="list-disc ml-5 space-y-1">
              <li>{t('legal.companionTerms.dutyUnmodified')}</li>
              <li>{t('legal.companionTerms.dutyTools')}</li>
              <li>{t('legal.companionTerms.dutyHarass')}</li>
            </ul>
          </div>

          <div>
            <h2 className={h2}>5. {t('legal.companionTerms.availabilityHeading')}</h2>
            <p>{t('legal.companionTerms.availabilityText')}</p>
          </div>

          <div>
            <h2 className={h2}>6. {t('legal.companionTerms.liabilityHeading')}</h2>
            <p>{t('legal.companionTerms.liabilityText')}</p>
          </div>

          <div>
            <h2 className={h2}>7. {t('legal.companionTerms.privacyHeading')}</h2>
            <p>
              {t('legal.companionTerms.privacyText')}{' '}
              <a href="/companion/privacy" className={LINK}>{t('legal.companionPrivacy.title')}</a>
            </p>
          </div>

          <div>
            <h2 className={h2}>8. {t('legal.companionTerms.finalHeading')}</h2>
            <p>{t('legal.companionTerms.finalText')}</p>
            <p className="mt-2">info@metastats.gg · <a href="/impressum" className={LINK}>{t('legal.imprint')}</a></p>
          </div>
        </section>
      </div>
      <Footer />
    </main>
  );
}
