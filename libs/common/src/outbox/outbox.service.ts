/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OutboxEventEntity, OutboxStatus } from './outbox-event.entity';
import { OutboxBridgeService } from 'apps/worker/src/outbox-bridge.service';

@Injectable()
export class OutboxService {
  constructor(
    @InjectRepository(OutboxEventEntity)
    private repo: Repository<OutboxEventEntity>,
    // @Optional() so existing modules that don't register WorkersModule
    // continue to work — bridge simply won't be available and all events
    // fall through to the DB outbox as before.
    @Optional()
    private readonly bridge: OutboxBridgeService | null,
  ) {}

  async enqueue(orgId: string, type: string, payload: any) {
    // Try BullMQ first via the bridge — returns true if handled
    if (this.bridge) {
      const handled = await this.bridge.bridge(type, { orgId, ...payload });
      if (handled) return; // BullMQ took it — skip DB write
    }

    // Fall back to DB outbox for unmapped event types
    return this.repo.save(
      this.repo.create({
        orgId,
        type,
        payload,
        status: OutboxStatus.PENDING,
      }),
    );
  }
}
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// import { Injectable } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { OutboxEventEntity, OutboxStatus } from './outbox-event.entity';

// @Injectable()
// export class OutboxService {
//   constructor(
//     @InjectRepository(OutboxEventEntity)
//     private repo: Repository<OutboxEventEntity>,
//   ) {}

//   async enqueue(orgId: string, type: string, payload: any) {
//     return this.repo.save(
//       this.repo.create({
//         orgId,
//         type,
//         payload,
//         status: OutboxStatus.PENDING,
//       }),
//     );
//   }
// }
