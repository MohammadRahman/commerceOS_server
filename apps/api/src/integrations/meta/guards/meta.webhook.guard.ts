/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class MetaSignatureGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req: any = ctx.switchToHttp().getRequest();
    const header = req.headers['x-hub-signature-256'] as string | undefined;
    const appSecret = this.config.getOrThrow<string>('META_APP_SECRET');
    const raw: Buffer | undefined = req.rawBody;

    if (!header || !raw) throw new UnauthorizedException('Missing signature');

    const expected = crypto
      .createHmac('sha256', appSecret)
      .update(raw)
      .digest('hex');
    const got = header.replace('sha256=', '');

    // timing-safe compare
    const ok =
      got.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));

    if (!ok) throw new UnauthorizedException('Invalid signature');
    return true;
  }
}
