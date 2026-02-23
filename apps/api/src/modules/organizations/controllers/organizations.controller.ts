/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Ctx } from '@app/common';
import {
  Controller,
  UseGuards,
  Patch,
  Param,
  Body,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrganizationEntity } from '../../tenancy/entities/organization.entity';

@Controller('v1/organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  private readonly logger = new Logger();
  constructor(
    @InjectRepository(OrganizationEntity)
    private orgs: Repository<OrganizationEntity>,
  ) {}

  @Patch(':orgId')
  async update(
    @Ctx() ctx: { orgId: string },
    @Param('orgId') orgId: string,
    @Body()
    body: {
      name?: string;
      timezone?: string;
      currency?: string;
      pickupAddress?: string;
    },
  ) {
    this.logger.log('org update hit');
    if (ctx.orgId !== orgId) throw new UnauthorizedException('Wrong org');

    await this.orgs.update(
      { id: orgId } as any,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.pickupAddress !== undefined
          ? { pickupAddress: body.pickupAddress }
          : {}),
      } as any,
    );

    return this.orgs.findOneOrFail({ where: { id: orgId } as any });
  }
}
