// v3 for comments
// v3
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// apps/api/src/integrations/meta/services/meta.oauth.service.ts
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
} from '../../../modules/inbox/entities/channel.entity';

type StartParams = { orgId: string; returnTo?: string };
type CallbackParams = { code: string; state: string };
type OAuthStatePayload = {
  orgId: string;
  returnTo?: string;
  iat: number;
  nonce: string;
};
type CallbackResult =
  | {
      ok: true;
      connected: number;
      pages: number;
      instagram: number;
      returnTo?: string;
    }
  | { ok: false; reason: string; returnTo?: string };

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

    // ── Scopes ──────────────────────────────────────────────────────────────
    // pages_show_list          — list pages the user manages
    // pages_manage_metadata    — subscribe to webhooks
    // pages_messaging          — send/receive Messenger messages
    // pages_read_engagement    — read posts, comments, likes on the page  ← NEW
    // pages_manage_engagement  — reply to / hide comments                 ← NEW
    const scope = [
      'pages_show_list',
      'pages_manage_metadata',
      'pages_messaging',
      'pages_read_engagement',
      'pages_manage_engagement',
    ].join(',');

    const state = this.signState({
      orgId: params.orgId,
      returnTo: params.returnTo,
      iat: Date.now(),
      nonce: crypto.randomUUID(),
    });

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

    if (Date.now() - state.iat > 60 * 60 * 1000) {
      return { ok: false, reason: 'State expired' };
    }

    const orgId = state.orgId;
    const returnTo = state.returnTo ?? '/settings';

    try {
      const shortUserToken = await this.exchangeCodeForToken(params.code);
      const longUserToken =
        await this.exchangeForLongLivedToken(shortUserToken);
      const accounts = await this.getUserAccounts(longUserToken);

      let pages = 0,
        instagram = 0,
        connected = 0;

      for (const acc of accounts) {
        pages++;

        const pageId = acc.id as string;
        const pageName = acc.name as string;
        const pageToken = acc.access_token as string;

        await this.subscribePageWebhooks(pageId, pageToken);

        connected += await this.upsertChannel({
          orgId,
          type: ChannelType.FACEBOOK,
          name: pageName,
          pageId,
          externalAccountId: pageId,
          token: pageToken,
        });

        const ig = acc.instagram_business_account?.id as string | undefined;
        const igUsername = acc.instagram_business_account?.username as
          | string
          | undefined;

        if (ig) {
          instagram++;
          connected += await this.upsertChannel({
            orgId,
            type: ChannelType.INSTAGRAM,
            name: igUsername ? `@${igUsername}` : `@${ig}`,
            pageId,
            externalAccountId: ig,
            igBusinessId: ig,
            token: pageToken,
          });
        }
      }

      return { ok: true, connected, pages, instagram, returnTo };
    } catch (e: any) {
      const msg =
        e?.response?.data?.error?.message ??
        e?.message ??
        'OAuth callback failed';
      return { ok: false, reason: msg, returnTo };
    }
  }

  redirectToFrontend(
    res: Response,
    result: CallbackResult,
    returnTo = '/settings',
  ) {
    const base = this.config.getOrThrow<string>('FRONTEND_URL');
    const rt = returnTo.startsWith('/') ? returnTo : `/${returnTo}`;
    const url = new URL(base + rt);

    if (result.ok) {
      url.searchParams.set('integration', 'meta');
      url.searchParams.set('ok', '1');
      url.searchParams.set('connected', String(result.connected));
      url.searchParams.set('pages', String(result.pages));
      url.searchParams.set('instagram', String(result.instagram));
    } else {
      url.searchParams.set('integration', 'meta');
      url.searchParams.set('ok', '0');
      url.searchParams.set('reason', result.reason);
    }

    return res.redirect(url.toString());
  }

  // ── Graph calls ────────────────────────────────────────────────────────────

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
    // ── Subscribed fields ────────────────────────────────────────────────────
    // messages               — incoming DMs
    // message_echoes         — outbound message copies (for read receipts)
    // messaging_postbacks    — button/quick-reply callbacks
    // messaging_reads        — read receipts
    // feed                   — comments on posts and live videos  ← NEW
    const fields =
      this.config.get<string>('META_WEBHOOK_SUBSCRIBED_FIELDS') ??
      'messages,message_echoes,messaging_postbacks,messaging_reads,feed';

    const url = new URL(
      `https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`,
    );
    url.searchParams.set('subscribed_fields', fields);
    url.searchParams.set('access_token', pageToken);

    await firstValueFrom(this.http.post(url.toString()));
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private async upsertChannel(params: {
    orgId: string;
    type: ChannelType;
    name: string;
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
          name: params.name,
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
        name: params.name,
        status: 'ACTIVE',
        pageId: params.pageId,
        igBusinessId: params.igBusinessId ?? existing.igBusinessId,
        accessTokenEnc,
        tokenExpiryAt: null,
      } as any,
    );

    return 0;
  }

  // ── Signed state ───────────────────────────────────────────────────────────

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
    const key = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET');
    const iv = crypto.randomBytes(12);
    const k = crypto.createHash('sha256').update(key).digest();
    const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }
}
// v2
// /* eslint-disable @typescript-eslint/no-unsafe-argument */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unsafe-return */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// // apps/api/src/integrations/meta/services/meta.oauth.service.ts
// // Fix: save page name (acc.name) and IG username so frontend shows real names
// import { Injectable } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { Response } from 'express';
// import { HttpService } from '@nestjs/axios';
// import { firstValueFrom } from 'rxjs';
// import * as crypto from 'crypto';

// import {
//   ChannelEntity,
//   ChannelType,
// } from '../../../modules/inbox/entities/channel.entity';

// type StartParams = { orgId: string; returnTo?: string };
// type CallbackParams = { code: string; state: string };
// type OAuthStatePayload = {
//   orgId: string;
//   returnTo?: string;
//   iat: number;
//   nonce: string;
// };
// type CallbackResult =
//   | {
//       ok: true;
//       connected: number;
//       pages: number;
//       instagram: number;
//       returnTo?: string;
//     }
//   | { ok: false; reason: string; returnTo?: string };

// @Injectable()
// export class MetaOAuthService {
//   constructor(
//     private config: ConfigService,
//     private http: HttpService,
//     @InjectRepository(ChannelEntity)
//     private channels: Repository<ChannelEntity>,
//   ) {}

//   buildStartUrl(params: StartParams) {
//     const appId = this.config.getOrThrow<string>('META_APP_ID');
//     const redirectUri = this.config.getOrThrow<string>('META_REDIRECT_URI');
//     const scope = [
//       'pages_show_list',
//       'pages_manage_metadata',
//       'pages_messaging',
//     ].join(',');
//     const state = this.signState({
//       orgId: params.orgId,
//       returnTo: params.returnTo,
//       iat: Date.now(),
//       nonce: crypto.randomUUID(),
//     });

//     const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
//     url.searchParams.set('client_id', appId);
//     url.searchParams.set('redirect_uri', redirectUri);
//     url.searchParams.set('response_type', 'code');
//     url.searchParams.set('state', state);
//     url.searchParams.set('scope', scope);

//     return { url: url.toString() };
//   }

//   async handleCallback(params: CallbackParams): Promise<CallbackResult> {
//     const state = this.verifyState(params.state);
//     if (!state) return { ok: false, reason: 'Invalid state' };

//     if (Date.now() - state.iat > 60 * 60 * 1000) {
//       return { ok: false, reason: 'State expired' };
//     }

//     const orgId = state.orgId;
//     const returnTo = state.returnTo ?? '/settings';

//     try {
//       const shortUserToken = await this.exchangeCodeForToken(params.code);
//       const longUserToken =
//         await this.exchangeForLongLivedToken(shortUserToken);
//       const accounts = await this.getUserAccounts(longUserToken);

//       let pages = 0,
//         instagram = 0,
//         connected = 0;

//       for (const acc of accounts) {
//         pages++;

//         const pageId = acc.id as string;
//         const pageName = acc.name as string; // ✅ Facebook page name
//         const pageToken = acc.access_token as string;

//         await this.subscribePageWebhooks(pageId, pageToken);

//         // ✅ Pass name to upsertChannel
//         connected += await this.upsertChannel({
//           orgId,
//           type: ChannelType.FACEBOOK,
//           name: pageName,
//           pageId,
//           externalAccountId: pageId,
//           token: pageToken,
//         });

//         // Instagram business account
//         const ig = acc.instagram_business_account?.id as string | undefined;
//         const igUsername = acc.instagram_business_account?.username as
//           | string
//           | undefined;

//         if (ig) {
//           instagram++;
//           // ✅ Use IG username as name, fallback to @{ig_id}
//           connected += await this.upsertChannel({
//             orgId,
//             type: ChannelType.INSTAGRAM,
//             name: igUsername ? `@${igUsername}` : `@${ig}`,
//             pageId,
//             externalAccountId: ig,
//             igBusinessId: ig,
//             token: pageToken,
//           });
//         }
//       }

//       return { ok: true, connected, pages, instagram, returnTo };
//     } catch (e: any) {
//       const msg =
//         e?.response?.data?.error?.message ??
//         e?.message ??
//         'OAuth callback failed';
//       return { ok: false, reason: msg, returnTo };
//     }
//   }

//   redirectToFrontend(
//     res: Response,
//     result: CallbackResult,
//     returnTo = '/settings',
//   ) {
//     const base = this.config.getOrThrow<string>('FRONTEND_URL');
//     const rt = returnTo.startsWith('/') ? returnTo : `/${returnTo}`;
//     const url = new URL(base + rt);

//     if (result.ok) {
//       url.searchParams.set('integration', 'meta');
//       url.searchParams.set('ok', '1');
//       url.searchParams.set('connected', String(result.connected));
//       url.searchParams.set('pages', String(result.pages));
//       url.searchParams.set('instagram', String(result.instagram));
//     } else {
//       url.searchParams.set('integration', 'meta');
//       url.searchParams.set('ok', '0');
//       url.searchParams.set('reason', result.reason);
//     }

//     return res.redirect(url.toString());
//   }

//   // ── Graph calls ───────────────────────────────────────────────────────────

//   private async exchangeCodeForToken(code: string): Promise<string> {
//     const appId = this.config.getOrThrow<string>('META_APP_ID');
//     const appSecret = this.config.getOrThrow<string>('META_APP_SECRET');
//     const redirectUri = this.config.getOrThrow<string>('META_REDIRECT_URI');

//     const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
//     url.searchParams.set('client_id', appId);
//     url.searchParams.set('client_secret', appSecret);
//     url.searchParams.set('redirect_uri', redirectUri);
//     url.searchParams.set('code', code);

//     const { data } = await firstValueFrom(this.http.get(url.toString()));
//     if (!data?.access_token) throw new Error('No access_token in response');
//     return data.access_token as string;
//   }

//   private async exchangeForLongLivedToken(shortToken: string): Promise<string> {
//     const appId = this.config.getOrThrow<string>('META_APP_ID');
//     const appSecret = this.config.getOrThrow<string>('META_APP_SECRET');

//     const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
//     url.searchParams.set('grant_type', 'fb_exchange_token');
//     url.searchParams.set('client_id', appId);
//     url.searchParams.set('client_secret', appSecret);
//     url.searchParams.set('fb_exchange_token', shortToken);

//     const { data } = await firstValueFrom(this.http.get(url.toString()));
//     if (!data?.access_token) throw new Error('No long-lived access_token');
//     return data.access_token as string;
//   }

//   private async getUserAccounts(userToken: string): Promise<any[]> {
//     const url = new URL('https://graph.facebook.com/v19.0/me/accounts');
//     // ✅ Include instagram username in fields
//     url.searchParams.set(
//       'fields',
//       'id,name,access_token,instagram_business_account{id,username}',
//     );
//     url.searchParams.set('access_token', userToken);

//     const { data } = await firstValueFrom(this.http.get(url.toString()));
//     return Array.isArray(data?.data) ? data.data : [];
//   }

//   private async subscribePageWebhooks(pageId: string, pageToken: string) {
//     const fields =
//       this.config.get<string>('META_WEBHOOK_SUBSCRIBED_FIELDS') ??
//       'messages,message_echoes,messaging_postbacks,messaging_reads';

//     const url = new URL(
//       `https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`,
//     );
//     url.searchParams.set('subscribed_fields', fields);
//     url.searchParams.set('access_token', pageToken);

//     await firstValueFrom(this.http.post(url.toString()));
//   }

//   // ── Persistence ───────────────────────────────────────────────────────────

//   private async upsertChannel(params: {
//     orgId: string;
//     type: ChannelType;
//     name: string; // ✅ now required
//     pageId: string;
//     externalAccountId: string;
//     igBusinessId?: string;
//     token: string;
//   }): Promise<number> {
//     const existing = await this.channels.findOne({
//       where: {
//         orgId: params.orgId,
//         type: params.type as any,
//         externalAccountId: params.externalAccountId,
//       } as any,
//     });

//     const accessTokenEnc = this.encrypt(params.token);

//     if (!existing) {
//       await this.channels.save(
//         this.channels.create({
//           orgId: params.orgId,
//           type: params.type,
//           name: params.name, // ✅ save name on create
//           status: 'ACTIVE',
//           pageId: params.pageId,
//           externalAccountId: params.externalAccountId,
//           igBusinessId: params.igBusinessId,
//           accessTokenEnc,
//           tokenExpiryAt: null,
//         } as any),
//       );
//       return 1;
//     }

//     await this.channels.update(
//       { id: existing.id } as any,
//       {
//         name: params.name, // ✅ update name on reconnect
//         status: 'ACTIVE',
//         pageId: params.pageId,
//         igBusinessId: params.igBusinessId ?? existing.igBusinessId,
//         accessTokenEnc,
//         tokenExpiryAt: null,
//       } as any,
//     );

//     return 0;
//   }

//   // ── Signed state ──────────────────────────────────────────────────────────

//   private signState(payload: OAuthStatePayload): string {
//     const secret = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET');
//     const json = Buffer.from(JSON.stringify(payload)).toString('base64url');
//     const sig = crypto
//       .createHmac('sha256', secret)
//       .update(json)
//       .digest('base64url');
//     return `${json}.${sig}`;
//   }

//   private verifyState(state: string): OAuthStatePayload | null {
//     const secret = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET');
//     const [json, sig] = (state ?? '').split('.');
//     if (!json || !sig) return null;

//     const expected = crypto
//       .createHmac('sha256', secret)
//       .update(json)
//       .digest('base64url');
//     if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
//       return null;

//     try {
//       const payload = JSON.parse(
//         Buffer.from(json, 'base64url').toString('utf8'),
//       ) as OAuthStatePayload;
//       if (!payload?.orgId || !payload?.iat) return null;
//       return payload;
//     } catch {
//       return null;
//     }
//   }

//   private encrypt(plain: string): string {
//     const key = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET');
//     const iv = crypto.randomBytes(12);
//     const k = crypto.createHash('sha256').update(key).digest();
//     const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
//     const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
//     const tag = cipher.getAuthTag();
//     return Buffer.concat([iv, tag, enc]).toString('base64');
//   }
// }
