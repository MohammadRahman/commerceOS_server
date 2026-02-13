/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Response } from 'express';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

import {
  ChannelEntity,
  ChannelType,
} from '../../../modules/inbox/entities/channel.entity'; // adjust import to your enum path

type StartParams = { orgId: string; returnTo?: string };
type CallbackParams = { code: string; state: string };

type OAuthStatePayload = {
  orgId: string;
  returnTo?: string;
  iat: number; // ms
  nonce: string;
};

type CallbackResult =
  | { ok: true; connected: number; pages: number; instagram: number }
  | { ok: false; reason: string };

@Injectable()
export class MetaOAuthService {
  constructor(
    private config: ConfigService,
    private http: HttpService,
    @InjectRepository(ChannelEntity)
    private channels: Repository<ChannelEntity>,
  ) {}

  buildStartUrl(params: StartParams) {
    const appId = this.config.getOrThrow<string>('META_APP_ID');
    const redirectUri = this.config.getOrThrow<string>('META_REDIRECT_URI');

    // Scopes: start with Pages + messaging; you can refine during App Review.
    const scope = [
      'pages_show_list',
      'pages_manage_metadata',
      'pages_messaging',
      'pages_read_engagement',
      'business_management',
      'instagram_manage_messages',
      'instagram_basic',
    ].join(',');

    const state = this.signState({
      orgId: params.orgId,
      returnTo: params.returnTo,
      iat: Date.now(),
      nonce: crypto.randomUUID(),
    });

    // Manual login flow uses dialog/oauth
    const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('scope', scope);

    return { url: url.toString() };
  }

  async handleCallback(params: CallbackParams): Promise<CallbackResult> {
    const state = this.verifyState(params.state);
    if (!state) return { ok: false, reason: 'Invalid state' };

    // Optional short TTL on state (10 minutes)
    if (Date.now() - state.iat > 10 * 60 * 1000) {
      return { ok: false, reason: 'State expired' };
    }

    const orgId = state.orgId;

    try {
      // 1) Exchange code -> short-lived user token
      const shortUserToken = await this.exchangeCodeForToken(params.code);

      // 2) Exchange -> long-lived user token
      const longUserToken =
        await this.exchangeForLongLivedToken(shortUserToken);

      // 3) Fetch pages + page tokens
      const accounts = await this.getUserAccounts(longUserToken);

      let pages = 0;
      let instagram = 0;
      let connected = 0;

      for (const acc of accounts) {
        pages++;

        const pageId = acc.id;
        const pageToken = acc.access_token;

        // 4) Subscribe page to app webhook
        await this.subscribePageWebhooks(pageId, pageToken);

        // 5) Upsert Facebook channel (page-level)
        connected += await this.upsertChannel({
          orgId,
          type: ChannelType.FACEBOOK,
          pageId,
          externalAccountId: pageId,
          token: pageToken,
        });

        // 6) If IG business account present, upsert IG channel too
        const ig = acc.instagram_business_account?.id;
        if (ig) {
          instagram++;
          connected += await this.upsertChannel({
            orgId,
            type: ChannelType.INSTAGRAM,
            pageId,
            externalAccountId: ig,
            igBusinessId: ig,
            token: pageToken, // IG messaging calls usually still use page token
          });
        }
      }

      return { ok: true, connected, pages, instagram };
    } catch (e: any) {
      const msg =
        e?.response?.data?.error?.message ??
        e?.message ??
        'OAuth callback failed';
      return { ok: false, reason: msg };
    }
  }

  redirectToFrontend(res: Response, result: CallbackResult) {
    const base = this.config.getOrThrow<string>('FRONTEND_URL');
    const url = new URL(base + '/integrations/meta/callback');

    if (result.ok) {
      url.searchParams.set('ok', '1');
      url.searchParams.set('connected', String(result.connected));
      url.searchParams.set('pages', String(result.pages));
      url.searchParams.set('instagram', String(result.instagram));
    } else {
      url.searchParams.set('ok', '0');
      url.searchParams.set('reason', result.reason);
    }

    return res.redirect(url.toString());
  }

  // -------- Graph calls --------

  private async exchangeCodeForToken(code: string): Promise<string> {
    const appId = this.config.getOrThrow<string>('META_APP_ID');
    const appSecret = this.config.getOrThrow<string>('META_APP_SECRET');
    const redirectUri = this.config.getOrThrow<string>('META_REDIRECT_URI');

    const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code', code);

    const { data } = await firstValueFrom(this.http.get(url.toString()));
    if (!data?.access_token) throw new Error('No access_token in response');
    return data.access_token as string;
  }

  private async exchangeForLongLivedToken(shortToken: string): Promise<string> {
    const appId = this.config.getOrThrow<string>('META_APP_ID');
    const appSecret = this.config.getOrThrow<string>('META_APP_SECRET');

    const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('fb_exchange_token', shortToken);

    const { data } = await firstValueFrom(this.http.get(url.toString()));
    if (!data?.access_token) throw new Error('No long-lived access_token');
    return data.access_token as string;
  }

  private async getUserAccounts(userToken: string): Promise<any[]> {
    // /me/accounts returns Pages the user can manage, including page access_token
    const url = new URL('https://graph.facebook.com/v19.0/me/accounts');
    url.searchParams.set(
      'fields',
      'id,name,access_token,instagram_business_account{id,username}',
    );
    url.searchParams.set('access_token', userToken);

    const { data } = await firstValueFrom(this.http.get(url.toString()));
    return Array.isArray(data?.data) ? data.data : [];
  }

  private async subscribePageWebhooks(pageId: string, pageToken: string) {
    const fields =
      this.config.get<string>('META_WEBHOOK_SUBSCRIBED_FIELDS') ??
      'messages,message_echoes,messaging_postbacks,messaging_reads';

    const url = new URL(
      `https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`,
    );
    url.searchParams.set('subscribed_fields', fields);
    url.searchParams.set('access_token', pageToken);

    await firstValueFrom(this.http.post(url.toString()));
  }

  // -------- persistence --------

  private async upsertChannel(params: {
    orgId: string;
    type: ChannelType;
    pageId: string;
    externalAccountId: string;
    igBusinessId?: string;
    token: string;
  }): Promise<number> {
    const existing = await this.channels.findOne({
      where: {
        orgId: params.orgId,
        type: params.type as any,
        externalAccountId: params.externalAccountId,
      } as any,
    });

    const accessTokenEnc = this.encrypt(params.token);

    if (!existing) {
      await this.channels.save(
        this.channels.create({
          orgId: params.orgId,
          type: params.type,
          status: 'ACTIVE',
          pageId: params.pageId,
          externalAccountId: params.externalAccountId,
          igBusinessId: params.igBusinessId,
          accessTokenEnc,
          tokenExpiryAt: null,
        } as any),
      );
      return 1;
    }

    await this.channels.update(
      { id: existing.id } as any,
      {
        status: 'ACTIVE',
        pageId: params.pageId,
        igBusinessId: params.igBusinessId ?? existing.igBusinessId,
        accessTokenEnc,
        tokenExpiryAt: null,
      } as any,
    );

    return 0;
  }

  // -------- signed state (no DB) --------

  private signState(payload: OAuthStatePayload): string {
    const secret = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET');
    const json = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto
      .createHmac('sha256', secret)
      .update(json)
      .digest('base64url');
    return `${json}.${sig}`;
  }

  private verifyState(state: string): OAuthStatePayload | null {
    const secret = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET');
    const [json, sig] = (state ?? '').split('.');
    if (!json || !sig) return null;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(json)
      .digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
      return null;

    try {
      const payload = JSON.parse(
        Buffer.from(json, 'base64url').toString('utf8'),
      ) as OAuthStatePayload;
      if (!payload?.orgId || !payload?.iat) return null;
      return payload;
    } catch {
      return null;
    }
  }

  private encrypt(plain: string): string {
    // Minimal “good enough for now” encryption. Replace with KMS/Vault later.
    const key = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET'); // reuse for now
    const iv = crypto.randomBytes(12);
    const k = crypto.createHash('sha256').update(key).digest(); // 32 bytes
    const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }
}

// /* eslint-disable prettier/prettier */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-unsafe-argument */
// import { Injectable, BadRequestException } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { HttpService } from '@nestjs/axios';
// import { firstValueFrom } from 'rxjs';
// import * as crypto from 'crypto';

// import { ChannelEntity } from '../../../modules/inbox/entities/channel.entity';
// import { ChannelType } from '../../../modules/inbox/entities/channel.entity';

// type StartParams = {
//   req: any;
//   flow: 'facebook' | 'whatsapp';
//   returnUrl: string;
// };

// type CallbackParams = {
//   code?: string;
//   state?: string;
//   error?: string;
//   errorDescription?: string;
// };

// type OAuthState = {
//   orgId: string;
//   flow: 'facebook' | 'whatsapp';
//   returnUrl: string;
//   iat: number;
// };

// @Injectable()
// export class MetaOAuthService {
//   constructor(
//     private config: ConfigService,
//     private http: HttpService,
//     @InjectRepository(ChannelEntity)
//     private channels: Repository<ChannelEntity>,
//   ) {}

//   buildAuthUrl(params: StartParams) {
//     const { req, flow, returnUrl } = params;

//     // orgId extraction: use your existing org context method.
//     // If you use req.user.orgId from JWT payload, this will work:
//     const orgId = (req)?.user?.orgId;
//     if (!orgId) throw new BadRequestException('Missing org context');

//     const appId = this.config.getOrThrow<string>('META_APP_ID');
//     const publicBase = this.config.getOrThrow<string>('PUBLIC_BASE_URL');

//     const redirectUri = `${publicBase}/v1/integrations/meta/oauth/callback`;

//     const state = this.signState({
//       orgId,
//       flow,
//       returnUrl,
//       iat: Date.now(),
//     });

//     const scope =
//       flow === 'facebook'
//         ? [
//             // minimal set to list pages + subscribe + messaging
//             'pages_show_list',
//             'pages_manage_metadata',
//             'pages_messaging',
//             'instagram_manage_messages',
//           ]
//         : [
//             // whatsapp cloud connect typically needs business scopes; keep flow separated
//             'whatsapp_business_management',
//             'whatsapp_business_messaging',
//             'business_management',
//           ];

//     const qs = new URLSearchParams({
//       client_id: appId,
//       redirect_uri: redirectUri,
//       state,
//       response_type: 'code',
//       scope: scope.join(','),
//     });

//     // Official manual flow uses /dialog/oauth with these params. :contentReference[oaicite:2]{index=2}
//     return `https://www.facebook.com/v19.0/dialog/oauth?${qs.toString()}`;
//   }

//   async handleCallback(
//     params: CallbackParams,
//   ): Promise<{ redirectUrl: string }> {
//     const { code, state, error, errorDescription } = params;

//     const frontend = this.config.getOrThrow<string>('FRONTEND_BASE_URL');

//     if (error) {
//       return {
//         redirectUrl: `${frontend}/settings/channels?meta=error&reason=${encodeURIComponent(errorDescription ?? error)}`,
//       };
//     }
//     if (!code || !state) throw new BadRequestException('Missing code/state');

//     const decoded = this.verifyState(state);

//     // Exchange code -> short-lived user token, then long-lived
//     const userToken = await this.exchangeCodeForToken(code);
//     const longLivedUserToken = await this.exchangeForLongLivedToken(userToken); // recommended :contentReference[oaicite:3]{index=3}

//     if (decoded.flow === 'facebook') {
//       await this.connectFacebookPages(decoded.orgId, longLivedUserToken);
//     } else {
//       // WhatsApp: implement later (waba/phone number selection UI)
//       // For now just return success
//     }

//     return {
//       redirectUrl: `${frontend}${decoded.returnUrl}?meta=connected`,
//     };
//   }

//   // ---------------- Graph calls ----------------

//   private async exchangeCodeForToken(code: string) {
//     const appId = this.config.getOrThrow<string>('META_APP_ID');
//     const appSecret = this.config.getOrThrow<string>('META_APP_SECRET');
//     const publicBase = this.config.getOrThrow<string>('PUBLIC_BASE_URL');
//     const redirectUri = `${publicBase}/v1/integrations/meta/oauth/callback`;

//     const url = `https://graph.facebook.com/v19.0/oauth/access_token`;
//     const qs = {
//       client_id: appId,
//       client_secret: appSecret,
//       redirect_uri: redirectUri,
//       code,
//     };

//     const { data } = await firstValueFrom(this.http.get(url, { params: qs }));
//     if (!data?.access_token)
//       throw new BadRequestException('Meta token exchange failed');
//     return data.access_token as string;
//   }

//   private async exchangeForLongLivedToken(shortLivedToken: string) {
//     const appId = this.config.getOrThrow<string>('META_APP_ID');
//     const appSecret = this.config.getOrThrow<string>('META_APP_SECRET');

//     // fb_exchange_token flow (long-lived user token). :contentReference[oaicite:4]{index=4}
//     const url = `https://graph.facebook.com/v19.0/oauth/access_token`;
//     const qs = {
//       grant_type: 'fb_exchange_token',
//       client_id: appId,
//       client_secret: appSecret,
//       fb_exchange_token: shortLivedToken,
//     };

//     const { data } = await firstValueFrom(this.http.get(url, { params: qs }));
//     if (!data?.access_token)
//       throw new BadRequestException('Meta long-lived token exchange failed');
//     return data.access_token as string;
//   }

//   private async connectFacebookPages(
//     orgId: string,
//     longLivedUserToken: string,
//   ) {
//     // /me/accounts gives Pages this user can access, including page access_token. :contentReference[oaicite:5]{index=5}
//     const url = `https://graph.facebook.com/v19.0/me/accounts`;
//     const { data } = await firstValueFrom(
//       this.http.get(url, {
//         params: {
//           fields: 'id,name,access_token',
//           access_token: longLivedUserToken,
//         },
//       }),
//     );

//     const pages: Array<{ id: string; name?: string; access_token: string }> =
//       data?.data ?? [];
//     for (const p of pages) {
//       const pageId = p.id;
//       const pageToken = p.access_token;

//       // upsert channel
//       await this.upsertFacebookChannel(orgId, pageId, pageToken);

//       // subscribe app to this page (enables page-level webhooks). :contentReference[oaicite:6]{index=6}
//       await this.subscribeAppToPage(pageId, pageToken);

//       // Try detect IG business account connected to page (optional; safe best-effort)
//       await this.tryUpsertInstagramChannel(orgId, pageId, pageToken);
//     }
//   }

//   private async upsertFacebookChannel(
//     orgId: string,
//     pageId: string,
//     pageToken: string,
//   ) {
//     const tokenEnc = this.encrypt(pageToken);

//     const existing = await this.channels.findOne({
//       where: [
//         { orgId, type: ChannelType.FACEBOOK, pageId },
//         { orgId, type: ChannelType.FACEBOOK, externalAccountId: pageId },
//       ] as any,
//     });

//     if (!existing) {
//       await this.channels.save({
//         orgId,
//         type: ChannelType.FACEBOOK,
//         pageId,
//         externalAccountId: pageId,
//         accessTokenEnc: tokenEnc,
//         status: 'ACTIVE',
//       } as any);
//     } else {
//       await this.channels.update(
//         { id: existing.id } as any,
//         {
//           pageId,
//           externalAccountId: pageId,
//           accessTokenEnc: tokenEnc,
//           status: 'ACTIVE',
//         } as any,
//       );
//     }
//   }

//   private async subscribeAppToPage(pageId: string, pageToken: string) {
//     const url = `https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`;
//     // POST to /{page-id}/subscribed_apps installs subscriptions. :contentReference[oaicite:7]{index=7}
//     await firstValueFrom(
//       this.http.post(
//         url,
//         new URLSearchParams({
//           subscribed_fields: 'messages,messaging_postbacks',
//         }).toString(),
//         {
//           headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//           params: { access_token: pageToken },
//         },
//       ),
//     ).catch(() => {
//       // best-effort in dev; in prod you should log error + show UI status “needs subscription”
//     });
//   }

//   private async tryUpsertInstagramChannel(
//     orgId: string,
//     pageId: string,
//     pageToken: string,
//   ) {
//     // Page node can return connected instagram_business_account. :contentReference[oaicite:8]{index=8}
//     const url = `https://graph.facebook.com/v19.0/${pageId}`;
//     const { data } = await firstValueFrom(
//       this.http.get(url, {
//         params: {
//           fields: 'instagram_business_account{id,username}',
//           access_token: pageToken,
//         },
//       }),
//     );

//     const ig = data?.instagram_business_account;
//     if (!ig?.id) return;

//     const tokenEnc = this.encrypt(pageToken);

//     const existing = await this.channels.findOne({
//       where: [
//         { orgId, type: ChannelType.INSTAGRAM, igBusinessId: ig.id },
//       ] as any,
//     });

//     if (!existing) {
//       await this.channels.save({
//         orgId,
//         type: ChannelType.INSTAGRAM,
//         igBusinessId: ig.id,
//         externalAccountId: ig.id,
//         accessTokenEnc: tokenEnc,
//         status: 'ACTIVE',
//       } as any);
//     } else {
//       await this.channels.update(
//         { id: existing.id } as any,
//         {
//           igBusinessId: ig.id,
//           externalAccountId: ig.id,
//           accessTokenEnc: tokenEnc,
//           status: 'ACTIVE',
//         } as any,
//       );
//     }
//   }

//   // ---------------- State signing ----------------

//   private signState(payload: OAuthState) {
//     const secret = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET');
//     const json = JSON.stringify(payload);
//     const sig = crypto.createHmac('sha256', secret).update(json).digest('hex');
//     return Buffer.from(`${json}.${sig}`).toString('base64url');
//   }

//   private verifyState(state: string): OAuthState {
//     const secret = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET');
//     const raw = Buffer.from(state, 'base64url').toString('utf8');
//     const idx = raw.lastIndexOf('.');
//     if (idx <= 0) throw new BadRequestException('Invalid state');

//     const json = raw.slice(0, idx);
//     const sig = raw.slice(idx + 1);

//     const expected = crypto
//       .createHmac('sha256', secret)
//       .update(json)
//       .digest('hex');
//     if (
//       sig.length !== expected.length ||
//       !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
//     ) {
//       throw new BadRequestException('Invalid state signature');
//     }

//     const decoded = JSON.parse(json) as OAuthState;

//     // TTL 10 minutes
//     if (Date.now() - decoded.iat > 10 * 60 * 1000)
//       throw new BadRequestException('State expired');
//     return decoded;
//   }

//   // ---------------- Simple encryption placeholder ----------------
//   // Replace with KMS/Cloud secrets later; this keeps tokens out of plaintext DB.
//   private encrypt(token: string) {
//     const secret = this.config.getOrThrow<string>('META_APP_SECRET');
//     // Not strong encryption; just avoids plaintext. Replace later with proper encryption (AES-GCM + random IV).
//     return Buffer.from(`${token}:${secret.slice(0, 6)}`).toString('base64');
//   }
// }
