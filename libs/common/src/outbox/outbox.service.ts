import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OutboxEventEntity, OutboxStatus } from './outbox-event.entity';

@Injectable()
export class OutboxService {
  constructor(
    @InjectRepository(OutboxEventEntity)
    private repo: Repository<OutboxEventEntity>,
  ) {}

  async enqueue(orgId: string, type: string, payload: any) {
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
