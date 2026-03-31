// apps/api/src/modules/notifications/services/sms.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly client: twilio.Twilio | null = null;
  private readonly from: string;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    this.from = this.config.get<string>('TWILIO_FROM') ?? '';
    this.enabled = !!(accountSid && authToken && this.from);

    if (this.enabled) {
      this.client = twilio(accountSid, authToken);
      this.logger.log('[SMS] Twilio provider initialized');
    } else {
      this.logger.warn(
        '[SMS] Twilio not configured — SMS notifications disabled',
      );
    }
  }

  async send(to: string, body: string): Promise<void> {
    if (!this.enabled || !this.client) {
      this.logger.warn(
        `[SMS] Skipped — not configured. Would send to ${to}: "${body}"`,
      );
      return;
    }
    try {
      await this.client.messages.create({ to, from: this.from, body });
      this.logger.log(`[SMS] Sent to ${to}`);
    } catch (err) {
      // SMS failure is non-fatal
      this.logger.error(`[SMS] Failed to send to ${to}`, err);
      throw err;
    }
  }

  async sendRaw(to: string, message: string): Promise<void> {
    return this.send(to, message);
  }

  async sendPasswordResetLink(params: {
    to: string;
    name: string;
    resetUrl: string;
    expiresInMinutes: number;
  }): Promise<void> {
    const { to, name, resetUrl, expiresInMinutes } = params;
    await this.send(
      to,
      `Hi ${name}, reset your Xenlo password (expires in ${expiresInMinutes} min):\n${resetUrl}\n\nIgnore if you didn't request this.`,
    );
  }

  async sendOtp(params: {
    to: string;
    name: string;
    otp: string;
    expiresInMinutes: number;
  }): Promise<void> {
    const { to, name, otp, expiresInMinutes } = params;
    await this.send(
      to,
      `Hi ${name}, your Xenlo password reset code is: ${otp}\n\nExpires in ${expiresInMinutes} minutes. Do not share this code.`,
    );
  }
}
// // apps/api/src/modules/notifications/sms.service.ts
// import { Injectable, Logger } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import twilio from 'twilio';

// @Injectable()
// export class SmsService {
//   private readonly logger = new Logger(SmsService.name);
//   private readonly client: twilio.Twilio | null = null;
//   private readonly from: string;
//   private readonly enabled: boolean;

//   constructor(private readonly config: ConfigService) {
//     const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
//     const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
//     this.from = this.config.get<string>('TWILIO_FROM') ?? '';
//     this.enabled = !!(accountSid && authToken && this.from);

//     if (this.enabled) {
//       this.client = twilio(accountSid, authToken);
//       this.logger.log('[SMS] Twilio provider initialized');
//     } else {
//       this.logger.warn(
//         '[SMS] Twilio not configured — SMS notifications disabled',
//       );
//     }
//   }

//   async send(to: string, body: string): Promise<void> {
//     if (!this.enabled || !this.client) {
//       this.logger.warn(
//         `[SMS] Skipped — not configured. Would send to ${to}: "${body}"`,
//       );
//       return;
//     }

//     try {
//       await this.client.messages.create({ to, from: this.from, body });
//       this.logger.log(`[SMS] Sent to ${to}`);
//     } catch (err) {
//       // SMS failure is non-fatal — email is the primary channel
//       this.logger.error(`[SMS] Failed to send to ${to}`, err);
//     }
//   }

//   async sendPasswordResetLink(params: {
//     to: string;
//     name: string;
//     resetUrl: string;
//     expiresInMinutes: number;
//   }): Promise<void> {
//     const { to, name, resetUrl, expiresInMinutes } = params;
//     const body = `Hi ${name}, reset your Xenlo password here (expires in ${expiresInMinutes} min):\n${resetUrl}\n\nIgnore if you didn't request this.`;
//     await this.send(to, body);
//   }
// }

/**
 * TODO: SSL Wireless integration (Bangladesh primary)
 *
 * When your SSL Wireless account is approved, add this provider:
 *
 * POST https://sms.sslwireless.com/pushapi/dynamic/server.php
 * Body (form-encoded):
 *   api_token=YOUR_TOKEN
 *   sid=YOUR_SID
 *   smsContent=MESSAGE
 *   csmsId=UNIQUE_ID
 *   mobile=880XXXXXXXXXX
 *
 * Then set SMS_PROVIDER=ssl_wireless in Railway and swap the client.
 * The interface stays the same — only the provider implementation changes.
 */
