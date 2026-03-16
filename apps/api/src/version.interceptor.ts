/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// apps/api/src/version.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * VersionInterceptor
 *
 * Injects X-App-Version header on every response so the frontend
 * can detect when the backend has been updated and prompt a refresh.
 *
 * The version is read from APP_VERSION env var — set this in Railway
 * to the git SHA or semver tag during your CD pipeline.
 *
 * Register globally in main.ts:
 *   app.useGlobalInterceptors(new VersionInterceptor());
 */
@Injectable()
export class VersionInterceptor implements NestInterceptor {
  private readonly version = process.env.APP_VERSION ?? 'dev';

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const response = http.getResponse();

    return next.handle().pipe(
      tap(() => {
        // Only set on HTTP responses — skip if already set (e.g. by a guard)
        if (!response.headersSent) {
          response.setHeader('X-App-Version', this.version);
        }
      }),
    );
  }
}
