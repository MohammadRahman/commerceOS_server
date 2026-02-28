/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// libs/common/src/logger/logger.module.ts
//
// Centralized Pino logger module — import AppLoggerModule in api.module.ts
// All config lives here. App module stays clean.
//
// Usage in services:
//   constructor(private logger: Logger) {}  ← from nestjs-pino
//   this.logger.log('message', { context: 'TeamController' });

import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        // ── Log level ────────────────────────────────────────────────────────
        // prod: only info and above (no debug noise)
        // dev:  everything including debug
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',

        // ── Transport ────────────────────────────────────────────────────────
        // dev:  pino-pretty — human readable, coloured, single line per request
        // prod: raw JSON to stdout — picked up by Loki / CloudWatch / Datadog
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  singleLine: true,
                  translateTime: 'HH:MM:ss',
                  ignore: 'pid,hostname',
                },
              }
            : undefined,

        // ── Request ID ───────────────────────────────────────────────────────
        // Propagates through every log line — essential for tracing a request
        // across multiple log entries. Frontend can pass X-Request-ID header
        // to correlate browser → API logs.
        genReqId: (req) =>
          (req.headers['x-request-id'] as string) ?? randomUUID(),

        // ── Redact sensitive fields ───────────────────────────────────────────
        // These paths are replaced with [REDACTED] before writing to stdout.
        // Prevents passwords/tokens ending up in log aggregators.
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.passwordHash',
            'req.body.refreshToken',
            'req.body.tempPassword',
          ],
          censor: '[REDACTED]',
        },

        // ── Skip noisy health check logs ─────────────────────────────────────
        autoLogging: {
          ignore: (req) =>
            req.url === '/health' ||
            req.url === '/health/live' ||
            req.url === '/health/ready' ||
            req.url === '/metrics',
        },

        // ── Request serializer ───────────────────────────────────────────────
        // Controls what request fields appear in the log.
        // Never log full body — could contain PII.
        serializers: {
          req(req) {
            return {
              id: req.id,
              method: req.method,
              url: req.url,
              // user agent for debugging client issues
              ua: req.headers?.['user-agent'],
            };
          },
          res(res) {
            return {
              statusCode: res.statusCode,
            };
          },
        },

        // ── Custom log attributes added to every line ─────────────────────────
        customProps: () => ({
          service: 'commerceos-api',
          env: process.env.NODE_ENV ?? 'development',
          version: process.env.APP_VERSION ?? 'local',
        }),
      },
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggerModule {}
