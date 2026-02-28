// v3 with full RBAC and permissions
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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RbacGuard } from '@app/common/guards/rbac.guard';
import { RequirePerm } from '@app/common/decorators/require-perm.decorator';
import { OrganizationEntity } from '../../tenancy/entities/organization.entity';

@Controller('v1/organizations')
@UseGuards(JwtAuthGuard, RbacGuard)
export class OrganizationsController {
  constructor(
    @InjectRepository(OrganizationEntity)
    private orgs: Repository<OrganizationEntity>,
  ) {}

  // ── GET — all roles ───────────────────────────────────────────────────────
  @Get(':orgId')
  @RequirePerm('org:read')
  async get(@Ctx() ctx: { orgId: string }, @Param('orgId') orgId: string) {
    if (ctx.orgId !== orgId) throw new UnauthorizedException('Wrong org');
    const org = await this.orgs.findOneOrFail({ where: { id: orgId } as any });
    return {
      id: org.id,
      name: org.name,
      currency: org.currency,
      timezone: org.timezone,
      pickupAddress: org.pickupAddress,
      plan: org.plan,
      countryCode: org.countryCode,
      isOnboarded: org.isOnboarded,
    };
  }

  // ── PATCH — OWNER only ────────────────────────────────────────────────────
  @Patch(':orgId')
  @RequirePerm('org:write')
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
    const org = await this.orgs.findOneOrFail({ where: { id: orgId } as any });
    return {
      id: org.id,
      name: org.name,
      currency: org.currency,
      timezone: org.timezone,
      pickupAddress: org.pickupAddress,
      plan: org.plan,
      countryCode: org.countryCode,
      isOnboarded: org.isOnboarded,
    };
  }
}
// v2
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// import { Ctx } from '@app/common';
// import {
//   Controller,
//   UseGuards,
//   Get,
//   Patch,
//   Param,
//   Body,
//   UnauthorizedException,
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
// import { OrganizationEntity } from '../../tenancy/entities/organization.entity';

// @Controller('v1/organizations')
// @UseGuards(JwtAuthGuard)
// export class OrganizationsController {
//   constructor(
//     @InjectRepository(OrganizationEntity)
//     private orgs: Repository<OrganizationEntity>,
//   ) {}

//   // GET /v1/organizations/:orgId
//   @Get(':orgId')
//   async get(@Ctx() ctx: { orgId: string }, @Param('orgId') orgId: string) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException('Wrong org');
//     const org = await this.orgs.findOneOrFail({ where: { id: orgId } as any });
//     return {
//       id: org.id,
//       name: org.name,
//       currency: org.currency,
//       timezone: org.timezone,
//       pickupAddress: org.pickupAddress,
//       plan: org.plan,
//       countryCode: org.countryCode,
//       isOnboarded: org.isOnboarded,
//     };
//   }

//   // PATCH /v1/organizations/:orgId
//   @Patch(':orgId')
//   async update(
//     @Ctx() ctx: { orgId: string },
//     @Param('orgId') orgId: string,
//     @Body()
//     body: {
//       name?: string;
//       timezone?: string;
//       currency?: string;
//       pickupAddress?: string;
//     },
//   ) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException('Wrong org');

//     await this.orgs.update(
//       { id: orgId } as any,
//       {
//         ...(body.name !== undefined ? { name: body.name } : {}),
//         ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
//         ...(body.currency !== undefined ? { currency: body.currency } : {}),
//         ...(body.pickupAddress !== undefined
//           ? { pickupAddress: body.pickupAddress }
//           : {}),
//       } as any,
//     );

//     const org = await this.orgs.findOneOrFail({ where: { id: orgId } as any });
//     return {
//       id: org.id,
//       name: org.name,
//       currency: org.currency,
//       timezone: org.timezone,
//       pickupAddress: org.pickupAddress,
//       plan: org.plan,
//       countryCode: org.countryCode,
//       isOnboarded: org.isOnboarded,
//     };
//   }
// }
// v1
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// import { Ctx } from '@app/common';
// import {
//   Controller,
//   UseGuards,
//   Patch,
//   Param,
//   Body,
//   UnauthorizedException,
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
// import { OrganizationEntity } from '../../tenancy/entities/organization.entity';

// @Controller('v1/organizations')
// @UseGuards(JwtAuthGuard)
// export class OrganizationsController {
//   constructor(
//     @InjectRepository(OrganizationEntity)
//     private orgs: Repository<OrganizationEntity>,
//   ) {}

//   @Patch(':orgId')
//   async update(
//     @Ctx() ctx: { orgId: string },
//     @Param('orgId') orgId: string,
//     @Body()
//     body: {
//       name?: string;
//       timezone?: string;
//       currency?: string;
//       pickupAddress?: string;
//     },
//   ) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException('Wrong org');

//     await this.orgs.update(
//       { id: orgId } as any,
//       {
//         ...(body.name !== undefined ? { name: body.name } : {}),
//         ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
//         ...(body.currency !== undefined ? { currency: body.currency } : {}),
//         ...(body.pickupAddress !== undefined
//           ? { pickupAddress: body.pickupAddress }
//           : {}),
//       } as any,
//     );

//     return this.orgs.findOneOrFail({ where: { id: orgId } as any });
//   }
// }
