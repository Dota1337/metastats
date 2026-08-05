// Sentry-Init für die Edge-Runtime (middleware.ts läuft mit Catch-all-Matcher
// auf jedem Request). Wird ausschliesslich aus register() dynamisch importiert.
import * as Sentry from '@sentry/nextjs';
import { sentryBaseOptions } from './app/lib/sentry-options';

Sentry.init(sentryBaseOptions);
