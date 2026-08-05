// Sentry-Init für die Node-Runtime. Wird ausschliesslich aus register() in
// instrumentation.ts dynamisch importiert — nie top-level, damit der Node-Code
// nicht in das Edge-Bundle der Middleware gerät.
import * as Sentry from '@sentry/nextjs';
import { sentryBaseOptions } from './app/lib/sentry-options';

Sentry.init(sentryBaseOptions);
