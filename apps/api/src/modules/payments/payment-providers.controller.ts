/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Ctx } from '@app/common';
import {
  Controller,
  UseGuards,
  Get,
  Patch,
  Param,
  Body,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentProviderEntity } from './entities/payment-provider.entity';

// payment-providers.controller.ts
@Controller('v1/payment-providers')
@UseGuards(JwtAuthGuard)
export class PaymentProvidersController {
  constructor(
    @InjectRepository(PaymentProviderEntity)
    private providers: Repository<PaymentProviderEntity>,
  ) {}

  @Get()
  async list(@Ctx() ctx: { orgId: string }) {
    return this.providers.find({
      where: { orgId: ctx.orgId } as any,
      order: { name: 'ASC' as any },
    });
  }

  @Patch(':id')
  async update(
    @Ctx() ctx: { orgId: string },
    @Param('id') id: string,
    @Body() body: { status: 'active' | 'inactive' },
  ) {
    const provider = await this.providers.findOne({ where: { id } as any });
    if (!provider || provider.orgId !== ctx.orgId)
      throw new UnauthorizedException();

    await this.providers.update({ id } as any, { status: body.status } as any);
    return this.providers.findOneOrFail({ where: { id } as any });
  }
}
