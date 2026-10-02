// Mehrseiten-Build: jedes Overwolf-Fenster ist eine eigene HTML-Seite.
// base './' weil die App unter overwolf-extension://<id>/ laeuft — absolute
// Pfade wuerden dort ins Leere zeigen.
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const WINDOWS = ['background', 'main', 'pinned', 'shop', 'matchup'];

export default defineConfig({
  // Vite setzt crossorigin an Skripte und Styles; unter overwolf-extension://
  // gibt es keine CORS-Antwort, also raus damit.
  plugins: [{
    name: 'strip-crossorigin',
    transformIndexHtml: html => html.replace(/ crossorigin(?=[ >])/g, ''),
  }],
  root: resolve(here, 'src'),
  base: './',
  publicDir: resolve(here, 'public'),
  build: {
    outDir: resolve(here, 'dist/app'),
    emptyOutDir: true,
    target: 'chrome110',
    modulePreload: false,
    rollupOptions: {
      input: Object.fromEntries(WINDOWS.map(w => [w, resolve(here, `src/windows/${w}.html`)])),
    },
  },
  server: { fs: { allow: [resolve(here, '../..')] } },
});
