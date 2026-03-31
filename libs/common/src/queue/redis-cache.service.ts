/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
// libs/common/src/queue/redis-cache.service.ts
// High-level caching helpers built on ioredis.
// Use this for storefront caching, feature flag caching, session caching.

import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { InjectRedis } from './redis.decorators';

@Injectable()
export class RedisCacheService {
  private readonly logger = new Logger(RedisCacheService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // ─── Generic get/set ──────────────────────────────────────────────────────

  async get<T>(key: string): Promise<T | null> {
    try {
      const val = await this.redis.get(key);
      return val ? (JSON.parse(val) as T) : null;
    } catch (e: any) {
      this.logger.warn(`[Cache] GET error for ${key}: ${e.message}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (e: any) {
      this.logger.warn(`[Cache] SET error for ${key}: ${e.message}`);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async delPattern(pattern: string): Promise<void> {
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
      this.logger.debug(
        `[Cache] Deleted ${keys.length} keys matching ${pattern}`,
      );
    }
  }

  // ─── Cache-aside helper ───────────────────────────────────────────────────

  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    fetchFn: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const fresh = await fetchFn();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  // ─── Storefront cache helpers ─────────────────────────────────────────────

  storeKey(slug: string) {
    return `store:${slug}`;
  }
  storeProductsKey(slug: string) {
    return `store:${slug}:products`;
  }

  async cacheStore(slug: string, data: any): Promise<void> {
    await this.set(this.storeKey(slug), data, 60); // 1 min TTL
  }

  async getCachedStore(slug: string): Promise<any | null> {
    return this.get(this.storeKey(slug));
  }

  async invalidateStore(slug: string): Promise<void> {
    await this.del(this.storeKey(slug));
    await this.del(this.storeProductsKey(slug));
  }

  // ─── Feature flags cache ──────────────────────────────────────────────────
  // Cache org feature flags so every request doesn't hit Postgres

  featureFlagsKey(orgId: string) {
    return `ff:${orgId}`;
  }

  async getCachedFeatureFlags(
    orgId: string,
  ): Promise<Record<string, boolean> | null> {
    return this.get<Record<string, boolean>>(this.featureFlagsKey(orgId));
  }

  async cacheFeatureFlags(
    orgId: string,
    flags: Record<string, boolean>,
  ): Promise<void> {
    await this.set(this.featureFlagsKey(orgId), flags, 300); // 5 min TTL
  }

  async invalidateFeatureFlags(orgId: string): Promise<void> {
    await this.del(this.featureFlagsKey(orgId));
  }

  // ─── Subscription plan cache ──────────────────────────────────────────────

  planKey(orgId: string) {
    return `plan:${orgId}`;
  }

  async getCachedPlan(orgId: string): Promise<string | null> {
    return this.get<string>(this.planKey(orgId));
  }

  async cachePlan(orgId: string, plan: string): Promise<void> {
    await this.set(this.planKey(orgId), plan, 300); // 5 min TTL
  }

  async invalidatePlan(orgId: string): Promise<void> {
    await this.del(this.planKey(orgId));
  }

  // ─── Live sale counters ───────────────────────────────────────────────────

  async getLiveSaleCounters(liveSaleId: string): Promise<{
    comments: number;
    orders: number;
  }> {
    const [comments, orders] = await this.redis.mget(
      `live:${liveSaleId}:comments`,
      `live:${liveSaleId}:orders`,
    );
    return {
      comments: parseInt(comments ?? '0', 10),
      orders: parseInt(orders ?? '0', 10),
    };
  }

  // ─── Rate limiting ────────────────────────────────────────────────────────

  async checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    const now = Date.now();
    const windowKey = `rl:${key}:${Math.floor(now / (windowSeconds * 1000))}`;

    const current = await this.redis.incr(windowKey);
    if (current === 1) {
      await this.redis.expire(windowKey, windowSeconds);
    }

    const ttl = await this.redis.ttl(windowKey);
    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      resetIn: ttl,
    };
  }
}
