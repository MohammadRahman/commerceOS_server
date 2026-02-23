import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { MetaOAuthService } from '../services/meta.oauth.service';

@Controller('v1/integrations/meta/oauth')
export class MetaOAuthController {
  constructor(private oauth: MetaOAuthService) {}

  @Get('start')
  start(@Query('orgId') orgId: string, @Query('returnTo') returnTo?: string) {
    if (!orgId) throw new UnauthorizedException('orgId is required');
    // UI will redirect to this URL
    return this.oauth.buildStartUrl({ orgId, returnTo });
  }

  @Get('callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    if (error) {
      return this.oauth.redirectToFrontend(res, {
        ok: false,
        reason: `${error}: ${errorDescription ?? ''}`.trim(),
      });
    }
    if (!code || !state) {
      return this.oauth.redirectToFrontend(res, {
        ok: false,
        reason: 'Missing code/state',
      });
    }

    const result = await this.oauth.handleCallback({ code, state });
    const decoded = this.oauth['verifyState'](state);
    return this.oauth.redirectToFrontend(
      res,
      result,
      decoded?.returnTo ?? '/settings',
    );
  }
}
