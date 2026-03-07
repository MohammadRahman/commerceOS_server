/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

export interface RedxConfig {
  /** Bearer token from RedX merchant portal */
  accessToken: string;
}

export interface RedxBookParams {
  customerName: string;
  customerPhone: string;
  deliveryArea: string; // e.g. "Mirpur-10, Dhaka"
  customerAddress: string;
  merchantInvoiceId: string;
  cashCollectionAmount: number;
  parcelWeight: number; // grams (RedX uses grams, not kg)
  instruction?: string;
  pickupStoreId?: number; // optional — uses default store if omitted
}

@Injectable()
export class RedxProvider {
  private readonly logger = new Logger(RedxProvider.name);
  private readonly baseUrl = 'https://openapi.redx.com.bd/v1.0.0-beta';

  constructor(private http: HttpService) {}

  private headers(cfg: RedxConfig) {
    return {
      Authorization: `Bearer ${cfg.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  // ── Book order ──────────────────────────────────────────────────────────────

  async bookOrder(cfg: RedxConfig, params: RedxBookParams) {
    const body = {
      customer_name: params.customerName,
      customer_phone: params.customerPhone,
      delivery_area: params.deliveryArea,
      customer_address: params.customerAddress,
      merchant_invoice_id: params.merchantInvoiceId,
      cash_collection_amount: params.cashCollectionAmount,
      parcel_weight: params.parcelWeight, // grams
      instruction: params.instruction ?? '',
      ...(params.pickupStoreId
        ? { pickup_store_id: params.pickupStoreId }
        : {}),
    };

    this.logger.log(
      `RedX bookOrder → POST ${this.baseUrl}/parcel body=${JSON.stringify(body)}`,
    );

    try {
      const { data } = await firstValueFrom(
        this.http.post(`${this.baseUrl}/parcel`, body, {
          headers: this.headers(cfg),
        }),
      );

      this.logger.log(`RedX bookOrder ← ${JSON.stringify(data)}`);

      const trackingId = String(data?.tracking_id ?? '');
      return {
        consignmentId: trackingId,
        trackingUrl: `https://redx.com.bd/track-parcel/?trackingId=${trackingId}`,
        raw: data,
      };
    } catch (err) {
      const axiosErr = err as AxiosError;
      this.logger.error(
        `RedX bookOrder FAILED — status=${axiosErr.response?.status} ` +
          `body=${JSON.stringify(axiosErr.response?.data)}`,
      );
      throw err;
    }
  }

  // ── Track order ─────────────────────────────────────────────────────────────

  async trackOrder(cfg: RedxConfig, trackingId: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`${this.baseUrl}/parcel/track/${trackingId}`, {
          headers: this.headers(cfg),
        }),
      );
      return {
        status: data?.parcel_status ?? 'unknown',
        raw: data,
      };
    } catch (err) {
      const axiosErr = err as AxiosError;
      this.logger.error(
        `RedX trackOrder FAILED — status=${axiosErr.response?.status} ` +
          `body=${JSON.stringify(axiosErr.response?.data)}`,
      );
      throw err;
    }
  }

  // ── Cancel order ─────────────────────────────────────────────────────────────

  cancelOrder(_cfg: RedxConfig, trackingId: string) {
    // RedX doesn't expose a public cancel API
    this.logger.warn(
      `RedX cancel requested for ${trackingId} — manual cancel required via portal`,
    );
    return {
      cancelled: false,
      message: 'RedX requires manual cancellation via merchant portal',
    };
  }

  // ── Calculate charge ─────────────────────────────────────────────────────────

  calculateCharge(
    _cfg: RedxConfig,
    params: { weightGrams: number; cashCollectionAmount: number },
  ) {
    // RedX flat rates (approx): inside Dhaka 60tk, outside 100tk
    // COD charge: 1% of collection amount
    const baseCharge = 100;
    const codCharge = Math.ceil(params.cashCollectionAmount * 0.01);
    return {
      deliveryCharge: baseCharge,
      codCharge,
      total: baseCharge + codCharge,
      currency: 'BDT',
    };
  }

  // ── Get areas ────────────────────────────────────────────────────────────────

  async getAreas(cfg: RedxConfig) {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`${this.baseUrl}/areas`, {
          headers: this.headers(cfg),
        }),
      );
      return data ?? { areas: [] };
    } catch (err) {
      const axiosErr = err as AxiosError;
      this.logger.error(
        `RedX getAreas FAILED — status=${axiosErr.response?.status} ` +
          `body=${JSON.stringify(axiosErr.response?.data)}`,
      );
      return { areas: [] };
    }
  }
}
