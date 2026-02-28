// apps/api/src/sentry.ts
// Initialize BEFORE NestFactory.create() in main.ts
// Import this as the very first line: import './sentry';

import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import * as dotenv from 'dotenv';
dotenv.config({ path: 'apps/api/.env' });
const dsn = process.env.SENTRY_DSN;
// const dsn =
//   'https://5281c379abb2e46997184f108bfad1cd@o4506056101986304.ingest.us.sentry.io/4510965597077504';
const env = process.env.NODE_ENV ?? 'development';

if (dsn) {
  Sentry.init({
    dsn,
    environment: env,
    release: process.env.APP_VERSION ?? 'local',

    integrations: [
      // Automatic performance tracing
      nodeProfilingIntegration(),
    ],

    // Capture 100% of transactions in dev, 10% in prod
    // Increase if you need more granular performance data
    tracesSampleRate: env === 'production' ? 0.1 : 1.0,
    profilesSampleRate: env === 'production' ? 0.1 : 1.0,

    // Never send PII to Sentry
    beforeSend(event) {
      // Scrub passwords from request bodies
      if (event.request?.data) {
        const data = event.request.data as Record<string, unknown>;
        if (data.password) data.password = '[REDACTED]';
        if (data.refreshToken) data.refreshToken = '[REDACTED]';
      }
      return event;
    },

    // Ignore noisy non-errors
    ignoreErrors: [
      'UnauthorizedException',
      'ForbiddenException',
      'NotFoundException',
      'BadRequestException',
    ],
  });

  console.log(`✅ Sentry initialized [${env}]`);
} else {
  console.warn('⚠️  SENTRY_DSN not set — error tracking disabled');
}
