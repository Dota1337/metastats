'use client';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import { useI18n } from '../lib/i18n';

// Nutzungsbedingungen der Website (Riot verlangt fuer die Riot-Anmeldung eine
// Terms-URL). Stand 14.11.2026: Konten mit E-Mail, Discord oder Riot,
// Riot-Verknuepfung, Marktwerte als Schaetzung. Die Companion App hat eigene
// Bedingungen (/companion/terms). Titel und canonical: layout.tsx.

const LINK = 'text-brand-text hover:underline';

export default function TermsPage() {
  const { t, withLang } = useI18n();
  const h2 = 'text-white text-base font-medium mb-2';

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-white text-2xl font-medium mb-1">{t('legal.terms')}</h1>
        <p className="text-xs text-fg-secondary mb-6">{t('legal.terms.updated')}</p>

        <section className="bg-surface-base border border-border-subtle rounded-lg p-6 space-y-6 text-sm text-fg-secondary leading-relaxed">
          <div>
            <h2 className={h2}>1. {t('legal.terms.scopeHeading')}</h2>
            <p>{t('legal.terms.scopeText')}</p>
          </div>

          <div>
            <h2 className={h2}>2. {t('legal.terms.serviceHeading')}</h2>
            <p>{t('legal.terms.serviceText')}</p>
          </div>

          <div>
            <h2 className={h2}>3. {t('legal.terms.accountHeading')}</h2>
            <p>{t('legal.terms.accountIntro')}</p>
            <ul className="list-disc ml-5 mt-2 space-y-1">
              <li>{t('legal.terms.accountPerson')}</li>
              <li>{t('legal.terms.accountTruthful')}</li>
              <li>{t('legal.terms.accountSecret')}</li>
              <li>{t('legal.terms.accountRiot')}</li>
            </ul>
          </div>

          <div>
            <h2 className={h2}>4. {t('legal.terms.useHeading')}</h2>
            <p>{t('legal.terms.useIntro')}</p>
            <ul className="list-disc ml-5 mt-2 space-y-1">
              <li>{t('legal.terms.useScraping')}</li>
              <li>{t('legal.terms.useAttacks')}</li>
              <li>{t('legal.terms.useImpersonate')}</li>
            </ul>
          </div>

          <div>
            <h2 className={h2}>5. {t('legal.terms.dataHeading')}</h2>
            <p>{t('legal.terms.dataText')}</p>
            <p className="mt-2">{t('legal.terms.marketValueText')}</p>
          </div>

          <div>
            <h2 className={h2}>6. {t('legal.imprint.riotHeading')}</h2>
            <p>{t('legal.imprint.riotDisclaimer')}</p>
          </div>

          <div>
            <h2 className={h2}>7. {t('legal.terms.liabilityHeading')}</h2>
            <p>{t('legal.terms.liabilityText')}</p>
          </div>

          <div>
            <h2 className={h2}>8. {t('legal.terms.endHeading')}</h2>
            <p>{t('legal.terms.endText')}</p>
            <p className="mt-2">{t('legal.terms.suspendText')}</p>
            <p className="mt-2">
              <a href={withLang('/auth/account')} className={LINK}>{t('legal.privacy.accountPage')}</a>
            </p>
          </div>

          <div>
            <h2 className={h2}>9. {t('legal.terms.changesHeading')}</h2>
            <p>{t('legal.terms.changesText')}</p>
          </div>

          <div>
            <h2 className={h2}>10. {t('legal.terms.lawHeading')}</h2>
            <p>{t('legal.terms.lawText')}</p>
          </div>

          <div>
            <h2 className={h2}>11. {t('legal.terms.contactHeading')}</h2>
            <p>{t('legal.terms.contactText')}</p>
            <p className="mt-2">
              info@metastats.gg · <a href={withLang('/impressum')} className={LINK}>{t('legal.imprint')}</a>
              {' · '}<a href={withLang('/datenschutz')} className={LINK}>{t('legal.privacy')}</a>
            </p>
          </div>
        </section>
      </div>
      <Footer />
    </main>
  );
}
