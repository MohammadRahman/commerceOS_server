/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

@Catch(QueryFailedError)
export class PostgresExceptionFilter implements ExceptionFilter {
  catch(
    exception: QueryFailedError & { driverError?: any },
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const code = exception?.driverError?.code;

    // 22P02 = invalid uuid
    if (code === '22P02') {
      return response.status(HttpStatus.BAD_REQUEST).json({
        message: 'Invalid UUID provided in request',
      });
    }

    // 23505 = unique violation
    if (code === '23505') {
      return response.status(HttpStatus.CONFLICT).json({
        message: 'Duplicate resource',
      });
    }

    // fallback
    console.error('[PostgresExceptionFilter] Unhandled DB error:', {
      code: exception?.driverError?.code,
      message: exception?.message,
      detail: exception?.driverError?.detail,
      query: (exception as any).query,
      parameters: (exception as any).parameters,
    });
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      message: 'Database error',
    });
  }
}
