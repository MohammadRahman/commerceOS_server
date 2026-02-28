/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface SslCommerzConfig {
  storeId: string;
  storePassword: string;
  sandbox?: boolean;
}

@Injectable()
export class SslCommerzProvider {
  private readonly logger = new Logger(SslCommerzProvider.name);

  private baseUrl(cfg: SslCommerzConfig) {
    return cfg.sandbox
      ? 'https://sandbox.sslcommerz.com'
      : 'https://securepay.sslcommerz.com';
  }

  constructor(private http: HttpService) {}

  // ── Create payment session ────────────────────────────────────────────────

  async createPayment(
    cfg: SslCommerzConfig,
    params: {
      amount: number;
      orderId: string;
      customerName: string;
      customerEmail: string;
      customerPhone: string;
      customerAddress: string;
      successUrl: string;
      failUrl: string;
      cancelUrl: string;
      ipnUrl: string;
    },
  ) {
    const formData = new URLSearchParams({
      store_id: cfg.storeId,
      store_passwd: cfg.storePassword,
      total_amount: String(params.amount),
      currency: 'BDT',
      tran_id: params.orderId,
      success_url: params.successUrl,
      fail_url: params.failUrl,
      cancel_url: params.cancelUrl,
      ipn_url: params.ipnUrl,
      cus_name: params.customerName,
      cus_email: params.customerEmail,
      cus_phone: params.customerPhone,
      cus_add1: params.customerAddress,
      cus_city: 'Dhaka',
      cus_country: 'Bangladesh',
      shipping_method: 'NO',
      product_name: 'Order',
      product_category: 'General',
      product_profile: 'general',
    });

    const { data } = await firstValueFrom(
      this.http.post(
        `${this.baseUrl(cfg)}/gwprocess/v4/api.php`,
        formData.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      ),
    );

    if (data?.status !== 'SUCCESS') {
      throw new Error(`SSLCommerz error: ${data?.failedreason ?? 'unknown'}`);
    }

    return {
      providerRef: data?.sessionkey ?? '',
      url: data?.GatewayPageURL ?? '',
      raw: data,
    };
  }

  // ── Validate IPN / webhook ────────────────────────────────────────────────

  async validatePayment(cfg: SslCommerzConfig, valId: string) {
    const { data } = await firstValueFrom(
      this.http.get(
        `${this.baseUrl(cfg)}/validator/api/validationserverAPI.php`,
        {
          params: {
            val_id: valId,
            store_id: cfg.storeId,
            store_passwd: cfg.storePassword,
            format: 'json',
          },
        },
      ),
    );

    return {
      status:
        data?.status === 'VALID' || data?.status === 'VALIDATED'
          ? 'paid'
          : 'failed',
      transactionId: data?.bank_tran_id ?? '',
      raw: data,
    };
  }

  // ── Query transaction ─────────────────────────────────────────────────────

  async queryTransaction(cfg: SslCommerzConfig, tranId: string) {
    const { data } = await firstValueFrom(
      this.http.get(
        `${this.baseUrl(cfg)}/validator/api/merchantTransIDvalidationAPI.php`,
        {
          params: {
            tran_id: tranId,
            store_id: cfg.storeId,
            store_passwd: cfg.storePassword,
            format: 'json',
          },
        },
      ),
    );

    const element = data?.element?.[0];
    return {
      status: element?.status === 'VALID' ? 'paid' : 'pending',
      transactionId: element?.bank_tran_id ?? '',
      raw: data,
    };
  }
}
