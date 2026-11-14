'use client';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import { useI18n } from '../lib/i18n';

// Datenschutzerklärung — DSGVO Art. 13 + 14. Lists every personal data flow:
// what we collect, why, retention, third-party processors, and user rights.
// Content reflects the actual data flows in metastats.gg as of 2026-11-14:
//   * Spielersuche → Riot API (Account-Resolve; Spielerdaten im Cache)
//   * Match-Cache, Marktwert-Snapshots → Supabase (puuid + game data)
//   * Benutzerkonten (Supabase Auth: E-Mail, Name, Avatar, Konto-ID,
//     Zeitstempel) — personenbezogen, NICHT mehr „nur puuid“
//   * Riot-Anmeldung/Verknuepfung (RSO): PUUID, Riot-ID, has_tft/LoL,
//     LoL-Region; Riot-Token werden nicht gespeichert
//   * Cookies: Sprache, tft_author_token, Supabase-Sitzung (sb-*),
//     Riot-Login-Cookie (max. 10 min, nur waehrend der Riot-Anmeldung)
//   * Vercel Analytics (hashed/anonymous — no IP, no third-party cookies)

const LINK = 'text-brand-text hover:underline';

export default function DatenschutzPage() {
  const { t, withLang } = useI18n();

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-white text-2xl font-medium mb-6">{t('legal.privacy')}</h1>

        <section className="bg-surface-base border border-border-subtle rounded-lg p-6 space-y-6 text-sm text-fg-secondary leading-relaxed">
          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.overviewHeading')}</h2>
            <p>{t('legal.privacy.overviewText')}</p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.controllerHeading')}</h2>
            <p>
              info@metastats.gg · <a href={withLang('/impressum')} className={LINK}>{t('legal.imprint')}</a>
            </p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.dataCollectedHeading')}</h2>
            <p>{t('legal.privacy.dataCollectedIntro')}</p>
            <ul className="list-disc ml-5 mt-2 space-y-1">
              <li>{t('legal.privacy.dataRiot')}</li>
              <li>{t('legal.privacy.dataLogs')}</li>
              <li>{t('legal.privacy.dataLang')}</li>
              <li>{t('legal.privacy.dataAccount')}</li>
            </ul>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.accountHeading')}</h2>
            <p>{t('legal.privacy.accountText')}</p>
            <p className="mt-3">{t('legal.privacy.accountData')}</p>
            <p className="mt-3">{t('legal.privacy.accountPurpose')}</p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.riotHeading')}</h2>
            <p>{t('legal.privacy.riotIntro')}</p>
            <p className="mt-3">{t('legal.privacy.riotToken')}</p>
            <p className="mt-3">{t('legal.privacy.riotStored')}</p>
            <p className="mt-3">{t('legal.privacy.riotEmail')}</p>
            <p className="mt-3">{t('legal.privacy.riotPurpose')}</p>
            <p className="mt-3">{t('legal.privacy.riotDeletion')}</p>
            <p className="mt-3">
              <a href={withLang('/auth/account')} className={LINK}>{t('legal.privacy.accountPage')}</a>
            </p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.processorsHeading')}</h2>
            <ul className="list-disc ml-5 space-y-1">
              <li>{t('legal.privacy.processorVercel')}</li>
              <li>{t('legal.privacy.processorSupabase')}</li>
              <li>{t('legal.privacy.processorRiot')}</li>
              <li>{t('legal.privacy.processorCdragon')}</li>
              <li>{t('legal.privacy.processorSentry')}</li>
            </ul>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.cookiesHeading')}</h2>
            <p>{t('legal.privacy.cookiesText')}</p>
            <p className="mt-3">{t('legal.privacy.cookiesLogin')}</p>
          </div>

          <div>
            <h2 className="text-white text-base font-medium mb-2">{t('legal.privacy.retentionHeading')}</h2>
            <p>{t('legal.privacy.retentionText')}</p>
            <p className="mt-3">{t('legal.privacy.retentionAccount')}</p>
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
