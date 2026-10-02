// Gemeinsamer Start jedes sichtbaren Fensters: Sprache setzen und bei
// Sprachwechsel neu zeichnen.
import { read, subscribe } from './store.ts';
import { resolveLang, setLang, lang } from './i18n.ts';

export async function boot(render: () => void): Promise<void> {
  setLang(await resolveLang(read('ms.settings').lang));
  render();
  subscribe(['ms.settings'], async () => {
    const next = await resolveLang(read('ms.settings').lang);
    if (next !== lang()) {
      setLang(next);
      render();
    }
  });
}
