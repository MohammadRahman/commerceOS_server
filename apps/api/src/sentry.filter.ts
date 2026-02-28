/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

@Catch()
export class SentryFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // Skip 4xx — only capture real errors
    const isHttp = exception instanceof HttpException;
    if (!isHttp || (exception as HttpException).getStatus() >= 500) {
      Sentry.captureException(exception);
    }
    super.catch(exception, host);
  }
}
