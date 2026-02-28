/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface SteadfastConfig {
  apiKey: string;
  secretKey: string;
}

export interface SteadfastBookParams {
  invoiceId: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  codAmount: number;
  note?: string;
  weight?: number; // kg, default 0.5
}

@Injectable()
export class SteadfastProvider {
  private readonly logger = new Logger(SteadfastProvider.name);
  private readonly baseUrl = 'https://portal.steadfast.com.bd/api/v1';

  constructor(private http: HttpService) {}

  private headers(cfg: SteadfastConfig) {
    return {
      'Api-Key': cfg.apiKey,
      'Secret-Key': cfg.secretKey,
      'Content-Type': 'application/json',
    };
  }

  async bookOrder(cfg: SteadfastConfig, params: SteadfastBookParams) {
    const { data } = await firstValueFrom(
      this.http.post(
        `${this.baseUrl}/create_order`,
        {
          invoice: params.invoiceId,
          recipient_name: params.recipientName,
          recipient_phone: params.recipientPhone,
          recipient_address: params.recipientAddress,
          cod_amount: params.codAmount,
          note: params.note ?? '',
          weight: params.weight ?? 0.5,
        },
        { headers: this.headers(cfg) },
      ),
    );
    // Response: { status: 200, consignment: { consignment_id, tracking_code, ... } }
    return {
      consignmentId: String(data?.consignment?.consignment_id ?? ''),
      trackingCode: String(data?.consignment?.tracking_code ?? ''),
      trackingUrl: `https://steadfast.com.bd/t/${data?.consignment?.tracking_code ?? ''}`,
      raw: data,
    };
  }

  async trackOrder(cfg: SteadfastConfig, consignmentId: string) {
    const { data } = await firstValueFrom(
      this.http.get(`${this.baseUrl}/status_by_cid/${consignmentId}`, {
        headers: this.headers(cfg),
      }),
    );
    return {
      status: data?.delivery_status ?? 'unknown',
      raw: data,
    };
  }

  cancelOrder(cfg: SteadfastConfig, consignmentId: string) {
    // Steadfast doesn't have a cancel API — orders must be cancelled via portal
    // We mark it cancelled locally and note it
    this.logger.warn(
      `Steadfast cancel requested for ${consignmentId} — manual cancel required`,
    );
    return {
      cancelled: false,
      message: 'Steadfast requires manual cancellation via portal',
    };
  }

  calculateCharge(
    cfg: SteadfastConfig,
    params: {
      weight: number;
      codAmount: number;
    },
  ) {
    // Steadfast flat rates: inside Dhaka 70tk, outside 130tk, COD 1%
    const baseCharge = 130; // default outside Dhaka
    const codCharge = Math.ceil(params.codAmount * 0.01);
    return {
      deliveryCharge: baseCharge,
      codCharge,
      total: baseCharge + codCharge,
      currency: 'BDT',
    };
  }

  getAreas(_cfg: SteadfastConfig) {
    // Steadfast serves all Bangladesh districts
    return {
      areas: [
        { id: 'dhaka', name: 'Dhaka', charge: 70 },
        { id: 'outside_dhaka', name: 'Outside Dhaka', charge: 130 },
      ],
    };
  }
}
