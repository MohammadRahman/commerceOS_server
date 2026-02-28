/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface PathaoConfig {
  clientId: string;
  clientSecret: string;
  merchantId: string;
  storeId: string;
  // stored after OAuth
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
}

export interface PathaoBookParams {
  storeId: number;
  merchantOrderId: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientCity: number; // city id from zones
  recipientZone: number; // zone id from zones
  deliveryType: 48 | 12; // 48 = normal, 12 = express
  itemType: 2 | 1; // 2 = parcel, 1 = document
  specialInstruction?: string;
  itemQuantity: number;
  itemWeight: number;
  amountToCollect: number;
  itemDescription?: string;
}

@Injectable()
export class PathaoProvider {
  private readonly logger = new Logger(PathaoProvider.name);
  private readonly baseUrl = 'https://merchant.pathao.com/aladdin/api/v1';
  private readonly issueTokenUrl =
    'https://merchant.pathao.com/aladdin/api/v1/issue-token';

  constructor(private http: HttpService) {}

  // ── Auth ────────────────────────────────────────────────────────────────────

  async getAccessToken(cfg: PathaoConfig): Promise<string> {
    // If token is still valid, use it
    if (cfg.accessToken && cfg.tokenExpiresAt) {
      const expiresAt = new Date(cfg.tokenExpiresAt);
      if (expiresAt > new Date(Date.now() + 60_000)) {
        return cfg.accessToken;
      }
    }

    // Refresh or get new token
    const { data } = await firstValueFrom(
      this.http.post(this.issueTokenUrl, {
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        username: cfg.clientId,
        password: cfg.clientSecret,
        grant_type: 'password',
      }),
    );

    return data?.access_token ?? '';
  }

  private async authHeaders(cfg: PathaoConfig) {
    const token = await this.getAccessToken(cfg);
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  // ── Zones ───────────────────────────────────────────────────────────────────

  async getCities(cfg: PathaoConfig) {
    const { data } = await firstValueFrom(
      this.http.get(`${this.baseUrl}/countries/1/city-list`, {
        headers: await this.authHeaders(cfg),
      }),
    );
    return data?.data?.data ?? [];
  }

  async getZones(cfg: PathaoConfig, cityId: number) {
    const { data } = await firstValueFrom(
      this.http.get(`${this.baseUrl}/cities/${cityId}/zone-list`, {
        headers: await this.authHeaders(cfg),
      }),
    );
    return data?.data?.data ?? [];
  }

  async getAreas(cfg: PathaoConfig, zoneId: number) {
    const { data } = await firstValueFrom(
      this.http.get(`${this.baseUrl}/zones/${zoneId}/area-list`, {
        headers: await this.authHeaders(cfg),
      }),
    );
    return data?.data?.data ?? [];
  }

  // ── Pricing ─────────────────────────────────────────────────────────────────

  async calculateCharge(
    cfg: PathaoConfig,
    params: {
      storeId: number;
      itemWeight: number;
      deliveryType: number;
      itemType: number;
      recipientCity: number;
      recipientZone: number;
    },
  ) {
    const { data } = await firstValueFrom(
      this.http.post(`${this.baseUrl}/merchant/price-plan`, params, {
        headers: await this.authHeaders(cfg),
      }),
    );
    return data?.data ?? {};
  }

  // ── Orders ──────────────────────────────────────────────────────────────────

  async bookOrder(cfg: PathaoConfig, params: PathaoBookParams) {
    const { data } = await firstValueFrom(
      this.http.post(
        `${this.baseUrl}/orders`,
        {
          store_id: params.storeId,
          merchant_order_id: params.merchantOrderId,
          recipient_name: params.recipientName,
          recipient_phone: params.recipientPhone,
          recipient_address: params.recipientAddress,
          recipient_city: params.recipientCity,
          recipient_zone: params.recipientZone,
          delivery_type: params.deliveryType,
          item_type: params.itemType,
          special_instruction: params.specialInstruction ?? '',
          item_quantity: params.itemQuantity,
          item_weight: params.itemWeight,
          amount_to_collect: params.amountToCollect,
          item_description: params.itemDescription ?? '',
        },
        { headers: await this.authHeaders(cfg) },
      ),
    );
    return {
      consignmentId: String(data?.data?.consignment_id ?? ''),
      merchantOrderId: String(data?.data?.merchant_order_id ?? ''),
      trackingUrl: `https://merchant.pathao.com/tracking/${data?.data?.consignment_id ?? ''}`,
      raw: data,
    };
  }

  async trackOrder(cfg: PathaoConfig, consignmentId: string) {
    const { data } = await firstValueFrom(
      this.http.get(`${this.baseUrl}/orders/${consignmentId}`, {
        headers: await this.authHeaders(cfg),
      }),
    );
    return {
      status: data?.data?.order_status ?? 'unknown',
      raw: data,
    };
  }

  cancelOrder(cfg: PathaoConfig, consignmentId: string) {
    // Pathao doesn't have public cancel API — log for manual handling
    this.logger.warn(`Pathao cancel requested for ${consignmentId}`);
    return {
      cancelled: false,
      message: 'Contact Pathao merchant support to cancel',
    };
  }
}
