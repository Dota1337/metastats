'use client';
import { useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';
import { useAuth } from '../../lib/auth-context';
import { authErrorKey } from '../../lib/auth-error-keys';

// Kontoseite: Riot-Verknuepfung (verknuepfen / trennen) und Konto loeschen
// mit Rueckfrage. Loeschen und Trennen haengen nicht am Riot-Schalter.

const BTN = 'inline-block bg-surface-raised border border-border-subtle hover:border-brand-a40 text-white px-3 py-1.5 rounded text-xs';
const BTN_DANGER = 'inline-block bg-surface-raised border border-border-subtle hover:border-pos-loss-text text-pos-loss-text px-3 py-1.5 rounded text-xs';
const LINK = 'text-brand-text hover:underline';
const H2 = 'text-white text-sm font-medium mb-3';

export default function AccountClient({ errorCode }: { errorCode: string | null }) {
  const { t, withLang } = useI18n();
  const { user, loading, riot, refreshRiot, signOut } = useAuth();
  const [error, setError] = useState<string | null>(errorCode ? t(authErrorKey(errorCode)) : null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function unlink() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/account/riot', { method: 'DELETE' });
      if (!res.ok) setError(t('auth.err.generic'));
      await refreshRiot();
    } catch {
      setError(t('auth.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) { setError(t('auth.err.generic')); setBusy(false); return; }
      await signOut().catch(() => {});
      window.location.assign(withLang('/'));
    } catch {
      setError(t('auth.err.generic'));
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav />
      <div className="max-w-md mx-auto px-4 py-10">
        <h1 className="text-white text-2xl font-medium mb-4">{t('account.title')}</h1>
        {error && <div className="text-pos-loss-text text-xs mb-3">{error}</div>}

        {!loading && !user && (
          <a href={`/auth/login?next=${encodeURIComponent('/auth/account')}`} className={BTN}>{t('nav.login')}</a>
        )}

        {user && (
          <div className="space-y-4">
            <section className="bg-surface-base border border-border-subtle rounded-lg p-5">
              <div className="text-white text-sm font-medium">{user.name || '—'}</div>
              {user.email && <div className="text-fg-muted text-xs mt-0.5">{user.email}</div>}
            </section>

            {(riot?.link || riot?.enabled) && (
              <section className="bg-surface-base border border-border-subtle rounded-lg p-5">
                <h2 className={H2}>{t('account.riotHeading')}</h2>
                {riot.link ? (
                  <div className="space-y-3 text-sm">
                    <div className="text-white">{riot.link.gameName}<span className="text-fg-muted">#{riot.link.tagLine}</span></div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {riot.link.tftPath && <a href={withLang(riot.link.tftPath)} className={LINK}>{t('nav.myTftProfile')}</a>}
                      {riot.link.lolPath && <a href={withLang(riot.link.lolPath)} className={LINK}>{t('nav.myLolProfile')}</a>}
                    </div>
                    {!riot.riotOnly && (
                      <button onClick={unlink} disabled={busy} className={`${BTN} disabled:opacity-50`}>{t('nav.unlinkRiot')}</button>
                    )}
                  </div>
                ) : (
                  // Einfacher Link statt next/link: kein Vorab-Laden der Riot-Anmeldung.
                  <a href={`/auth/riot/start?mode=link&next=${encodeURIComponent('/auth/account')}`} className={BTN}>{t('nav.linkRiot')}</a>
                )}
              </section>
            )}

            <section className="bg-surface-base border border-border-subtle rounded-lg p-5">
              <h2 className={H2}>{t('nav.deleteAccount')}</h2>
              {confirmDelete ? (
                <div className="space-y-3">
                  <p className="text-sm text-fg-secondary">{t('account.deleteConfirm')}</p>
                  <div className="flex gap-2">
                    <button onClick={deleteAccount} disabled={busy} className={`${BTN_DANGER} disabled:opacity-50`}>{t('account.deleteYes')}</button>
                    <button onClick={() => setConfirmDelete(false)} disabled={busy} className={BTN}>{t('account.cancel')}</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className={BTN_DANGER}>{t('nav.deleteAccount')}</button>
              )}
            </section>
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
