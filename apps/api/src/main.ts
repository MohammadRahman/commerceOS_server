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
  // capture rawBody for webhook signature validation
  app.use(
    '/webhooks/meta',
    bodyParser.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf; // raw buffer for signature verify
      },
    }),
  );

  app.use(bodyParser.json());

  app.useGlobalFilters(new PostgresExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
