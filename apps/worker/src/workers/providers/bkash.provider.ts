/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface BkashConfig {
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
  sandbox?: boolean;
}

@Injectable()
export class BkashProvider {
  private readonly logger = new Logger(BkashProvider.name);

  constructor(private http: HttpService) {}

  private baseUrl(cfg: BkashConfig) {
    return cfg.sandbox
      ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta'
      : 'https://tokenized.pay.bka.sh/v1.2.0-beta';
  }

  // ── Grant token ───────────────────────────────────────────────────────────

  async grantToken(cfg: BkashConfig): Promise<string> {
    const { data } = await firstValueFrom(
      this.http.post(
        `${this.baseUrl(cfg)}/tokenized/checkout/token/grant`,
        { app_key: cfg.appKey, app_secret: cfg.appSecret },
        {
          headers: {
            username: cfg.username,
            password: cfg.password,
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    return data?.id_token ?? '';
  }

  // ── Create payment ────────────────────────────────────────────────────────

  async createPayment(
    cfg: BkashConfig,
    params: {
      amount: number;
      orderId: string;
      reference: string;
      callbackUrl: string;
    },
  ) {
    const token = await this.grantToken(cfg);

    const { data } = await firstValueFrom(
      this.http.post(
        `${this.baseUrl(cfg)}/tokenized/checkout/create`,
        {
          mode: '0011',
          payerReference: params.reference,
          callbackURL: params.callbackUrl,
          amount: String(params.amount),
          currency: 'BDT',
          intent: 'sale',
          merchantInvoiceNumber: params.orderId,
        },
        {
          headers: {
            Authorization: token,
            'X-APP-Key': cfg.appKey,
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    // data.bkashURL is the payment URL to send to customer
    return {
      providerRef: data?.paymentID ?? '',
      url: data?.bkashURL ?? '',
      raw: data,
    };
  }

  // ── Execute payment (after customer pays) ────────────────────────────────

  async executePayment(cfg: BkashConfig, paymentId: string) {
    const token = await this.grantToken(cfg);

    const { data } = await firstValueFrom(
      this.http.post(
        `${this.baseUrl(cfg)}/tokenized/checkout/execute`,
        { paymentID: paymentId },
        {
          headers: {
            Authorization: token,
            'X-APP-Key': cfg.appKey,
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    return {
      transactionId: data?.trxID ?? '',
      status: data?.statusCode === '0000' ? 'paid' : 'failed',
      raw: data,
    };
  }

  // ── Query payment status ──────────────────────────────────────────────────

  async queryPayment(cfg: BkashConfig, paymentId: string) {
    const token = await this.grantToken(cfg);

    const { data } = await firstValueFrom(
      this.http.post(
        `${this.baseUrl(cfg)}/tokenized/checkout/payment/status`,
        { paymentID: paymentId },
        {
          headers: {
            Authorization: token,
            'X-APP-Key': cfg.appKey,
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    return {
      status: data?.transactionStatus ?? 'unknown',
      transactionId: data?.trxID ?? '',
      raw: data,
    };
  }
}
