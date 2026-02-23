/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './api.module';
import { ValidationPipe } from '@nestjs/common';
import { PostgresExceptionFilter } from '@app/common';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });
  app.use((req: any, res: any, next: any) => {
    if (req.path.startsWith('/webhooks/meta')) {
      // Capture raw buffer AND parse JSON for webhook routes
      bodyParser.json({
        verify: (req: any, _res, buf) => {
          req.rawBody = buf;
        },
      })(req, res, next);
    } else {
      // Standard JSON parsing for everything else
      bodyParser.json()(req, res, next);
    }
  });
  app.enableCors({
    origin: 'http://localhost:8080',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.useGlobalFilters(new PostgresExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Bypass localtunnel browser warning for webhooks
  app.use((req: any, res: any, next: any) => {
    res.setHeader('bypass-tunnel-reminder', 'true');
    next();
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
