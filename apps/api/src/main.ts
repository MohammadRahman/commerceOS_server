// v2
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import './sentry'; // ← MUST be first — initializes before anything else loads
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './api.module';
import { ValidationPipe } from '@nestjs/common';
import { PostgresExceptionFilter } from '@app/common';
import * as bodyParser from 'body-parser';
import helmet from 'helmet';
import { SentryFilter } from './sentry.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // ──── Sentry ───────────────────────────────────────────────────
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryFilter(httpAdapter));
  // ── 1. Helmet — HTTP security headers ─────────────────────────────────────
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: [
            "'self'",
            'https://commerceos-ui.vercel.app',
            'https://*.vercel.app', // covers preview deploys
            'https://commerceosserver-production.up.railway.app',
            'https://*.ingest.sentry.io', // Sentry error reporting
          ],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
        },
      },
    }),
  );

  // ── 2. Body parser — raw buffer preserved for Meta HMAC verification ──────
  app.use((req: any, res: any, next: any) => {
    if (req.path.startsWith('/webhooks/meta')) {
      bodyParser.json({
        verify: (req: any, _res, buf) => {
          req.rawBody = buf;
        },
      })(req, res, next);
    } else {
      bodyParser.json({ limit: '1mb' })(req, res, next);
    }
  });

  // ── 3. CORS — strict origin whitelist ─────────────────────────────────────
  const allowedOrigins =
    process.env.NODE_ENV === 'production'
      ? (process.env.CORS_ORIGINS ?? '')
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : [
          'http://localhost:8080',
          'http://localhost:5173',
          'http://localhost:3001',
          'https://commerceosserver-production.up.railway.app',
        ];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  });

  // ── 4. Global exception filter ────────────────────────────────────────────
  app.useGlobalFilters(new PostgresExceptionFilter());

  // ── 5. Global validation pipe ─────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── 6. Localtunnel bypass header (dev only) ───────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    app.use((_req: any, res: any, next: any) => {
      res.setHeader('bypass-tunnel-reminder', 'true');
      next();
    });
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(
    `🚀 API running on :${port} [${process.env.NODE_ENV ?? 'development'}]`,
  );
}

bootstrap();

/**
 * migration scripts 
 *     "migration:generate": "npm run typeorm -- migration:generate",
    "migration:run": "npm run typeorm -- migration:run",
    "migration:revert": "npm run typeorm -- migration:revert",
 * */

/**
 * From toml config
 * # railway.toml
# Railway project configuration
# Docs: https://docs.railway.app/reference/config-as-code

[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "node dist/apps/api/main"
healthcheckPath = "/health/live"
healthcheckTimeout = 60
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3

# Railway injects PORT automatically — your main.ts already reads process.env.PORT
 * */
