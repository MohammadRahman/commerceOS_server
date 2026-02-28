/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

export interface NagadConfig {
  merchantId: string;
  merchantNumber: string;
  publicKey: string; // Nagad's public key (for encrypting)
  privateKey: string; // Merchant's private key (for signing)
  sandbox?: boolean;
}

@Injectable()
export class NagadProvider {
  private readonly logger = new Logger(NagadProvider.name);

  private baseUrl(cfg: NagadConfig) {
    return cfg.sandbox
      ? 'https://sandbox.mynagad.com:10080/remote-payment-gateway-1.0'
      : 'https://api.mynagad.com/api/dfs';
  }

  constructor(private http: HttpService) {}

  // ── Encrypt with Nagad public key ─────────────────────────────────────────

  private encrypt(data: string, publicKey: string): string {
    const buffer = Buffer.from(data);
    const encrypted = crypto.publicEncrypt(
      {
        key: `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      buffer,
    );
    return encrypted.toString('base64');
  }

  // ── Sign with merchant private key ────────────────────────────────────────

  private sign(data: string, privateKey: string): string {
    const sign = crypto.createSign('SHA256');
    sign.update(data);
    return sign.sign(
      `-----BEGIN RSA PRIVATE KEY-----\n${privateKey}\n-----END RSA PRIVATE KEY-----`,
      'base64',
    );
  }

  // ── Initialize payment ────────────────────────────────────────────────────

  async createPayment(
    cfg: NagadConfig,
    params: {
      amount: number;
      orderId: string;
      callbackUrl: string;
    },
  ) {
    const datetime = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 14);

    const sensitiveData = {
      merchantId: cfg.merchantId,
      datetime,
      orderId: params.orderId,
      challenge: crypto.randomBytes(16).toString('hex'),
    };

    const encryptedData = this.encrypt(
      JSON.stringify(sensitiveData),
      cfg.publicKey,
    );

    const signature = this.sign(JSON.stringify(sensitiveData), cfg.privateKey);

    // Step 1: Initialize
    const { data: initData } = await firstValueFrom(
      this.http.post(
        `${this.baseUrl(cfg)}/check-out/initialize/${cfg.merchantId}/${params.orderId}`,
        { dateTime: datetime, sensitiveData: encryptedData, signature },
        {
          headers: {
            'X-KM-Api-Version': 'v-0.2.0',
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    const paymentReferenceId = initData?.paymentReferenceId ?? '';
    const challenge = initData?.challenge ?? '';

    // Step 2: Complete checkout
    const checkoutData = {
      merchantId: cfg.merchantId,
      orderId: params.orderId,
      currencyCode: '050',
      amount: String(params.amount),
      challenge,
    };

    const encryptedCheckout = this.encrypt(
      JSON.stringify(checkoutData),
      cfg.publicKey,
    );
    const checkoutSignature = this.sign(
      JSON.stringify(checkoutData),
      cfg.privateKey,
    );

    const { data: checkoutResult } = await firstValueFrom(
      this.http.post(
        `${this.baseUrl(cfg)}/check-out/complete/${paymentReferenceId}`,
        {
          sensitiveData: encryptedCheckout,
          signature: checkoutSignature,
          merchantCallbackURL: params.callbackUrl,
        },
        {
          headers: {
            'X-KM-Api-Version': 'v-0.2.0',
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    return {
      providerRef: paymentReferenceId,
      url: checkoutResult?.callBackUrl ?? '',
      raw: checkoutResult,
    };
  }

  // ── Verify payment ────────────────────────────────────────────────────────

  async verifyPayment(cfg: NagadConfig, paymentRefId: string) {
    const { data } = await firstValueFrom(
      this.http.get(`${this.baseUrl(cfg)}/verify/payment/${paymentRefId}`, {
        headers: { 'X-KM-Api-Version': 'v-0.2.0' },
      }),
    );

    return {
      status: data?.status === 'Success' ? 'paid' : 'pending',
      transactionId: data?.merchantOrderId ?? '',
      raw: data,
    };
  }
}
