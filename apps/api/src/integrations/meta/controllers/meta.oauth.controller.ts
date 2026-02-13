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
    return this.oauth.redirectToFrontend(res, result);
  }
}

// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
// import type { Response, Request } from 'express';

// import { JwtAuthGuard } from '../../../modules/auth/guards/jwt-auth.guard';
// import { MetaOAuthService } from '../services/meta.oauth.service';

// @Controller('v1/integrations/meta/oauth')
// @UseGuards(JwtAuthGuard)
// export class MetaOAuthController {
//   constructor(private oauth: MetaOAuthService) {}

//   /**
//    * UI hits this -> backend redirects to Meta OAuth dialog.
//    * Example:
//    * GET /v1/integrations/meta/oauth/start?flow=facebook&returnUrl=/settings/channels
//    */
//   @Get('start')
//   start(
//     @Req() req: Request,
//     @Res() res: Response,
//     @Query('flow') flow: 'facebook' | 'whatsapp' = 'facebook',
//     @Query('returnUrl') returnUrl = '/settings/channels',
//   ) {
//     const url = this.oauth.buildAuthUrl({
//       req,
//       flow,
//       returnUrl,
//     });
//     return res.redirect(url);
//   }

//   /**
//    * Meta redirects here with code+state
//    */
//   @Get('callback')
//   async callback(
//     @Req() req: Request,
//     @Res() res: Response,
//     @Query('code') code?: string,
//     @Query('state') state?: string,
//     @Query('error') error?: string,
//     @Query('error_description') errorDescription?: string,
//   ) {
//     const result = await this.oauth.handleCallback({
//       code,
//       state,
//       error,
//       errorDescription,
//     });

//     // redirect back to UI with a simple status
//     const redirectUrl = result.redirectUrl;
//     return res.redirect(redirectUrl);
//   }
// }
