// Registriert den TS-Resolver für den Testlauf. Siehe ts-extension-resolver.mjs
// für das Warum. Eingebunden über `--import` im `test`-Script von package.json.

import { register } from 'node:module';

register('./ts-extension-resolver.mjs', import.meta.url);
