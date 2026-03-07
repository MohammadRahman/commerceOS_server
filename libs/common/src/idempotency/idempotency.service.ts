/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdempotencyKeyEntity } from './idempotency-key.entity';

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyKeyEntity)
    private repo: Repository<IdempotencyKeyEntity>,
  ) {}

  /**
   * Returns true if the key was successfully claimed (first time).
   * Returns false if it was already claimed (duplicate delivery).
   */
  async claim(
    orgId: string,
    scope: string,
    key: string,
    opts?: { requestHash?: string; ttlSeconds?: number },
  ): Promise<boolean> {
    const expiresAt =
      opts?.ttlSeconds && opts.ttlSeconds > 0
        ? new Date(Date.now() + opts.ttlSeconds * 1000)
        : null;

    try {
      await this.repo.insert({
        orgId,
        scope,
        key,
        requestHash: opts?.requestHash,
        expiresAt: expiresAt ?? undefined,
      });
      return true;
    } catch (e: any) {
      // Postgres unique violation = duplicate claim
      if (e?.code === '23505') return false;
      throw e;
    }
  }
}
