/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Ctx } from '@app/common';
import * as crypto from 'crypto';
import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ChannelEntity } from '../../inbox/entities/channel.entity';
import { PaymentProviderEntity } from '../../payments/entities/payment-provider.entity';
import { OrgCourierProviderEntity } from '../../providers/entities/org-courier-provider.entity';
import { OrgPaymentProviderEntity } from '../../providers/entities/org-payment-provider.entity';
import { OrganizationEntity } from '../../tenancy/entities/organization.entity';
import { UserEntity } from '../../tenancy/entities/user.entity';

@Controller('v1/onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  private readonly logger = new Logger(OnboardingController.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(OrganizationEntity)
    private orgs: Repository<OrganizationEntity>,
    @InjectRepository(ChannelEntity)
    private channels: Repository<ChannelEntity>,
    @InjectRepository(PaymentProviderEntity)
    private paymentProviders: Repository<PaymentProviderEntity>,
    @InjectRepository(OrgPaymentProviderEntity)
    private orgPayments: Repository<OrgPaymentProviderEntity>,
    @InjectRepository(OrgCourierProviderEntity)
    private orgCouriers: Repository<OrgCourierProviderEntity>,
  ) {}

  // ── GET /v1/onboarding/state ──────────────────────────────────────────────

  @Get('state')
  async state(@Ctx() ctx: { orgId: string }) {
    const [org, channels, orgPaymentProviders, orgCourierProviders] =
      await Promise.all([
        this.orgs.findOneOrFail({ where: { id: ctx.orgId } as any }),
        this.channels.find({ where: { orgId: ctx.orgId } as any }),
        this.orgPayments.find({ where: { orgId: ctx.orgId } as any }),
        this.orgCouriers.find({ where: { orgId: ctx.orgId } as any }),
      ]);

    return {
      org: {
        id: org.id,
        name: org.name,
        timezone: org.timezone,
        currency: org.currency,
        pickupAddress: org.pickupAddress,
        plan: org.plan,
        isOnboarded: org.isOnboarded,
      },
      channels: channels.map((c) => ({
        id: c.id,
        type: c.type,
        name: c.pageId ?? c.externalAccountId ?? c.type,
        status: c.status === 'ACTIVE' ? 'connected' : 'disconnected',
        connectedAt: c.createdAt,
      })),
      paymentProviders: orgPaymentProviders.map((p) => ({
        id: p.id,
        type: p.type,
        name: p.type,
        status: p.status,
        config: undefined, // never expose config to frontend
      })),
      courierProviders: orgCourierProviders.map((c) => ({
        id: c.id,
        type: c.type,
        name: c.type,
        status: c.status,
        config: undefined,
      })),
      progress: {
        workspace: Boolean(org.name),
        channels: channels.some((c) => c.status === 'ACTIVE'),
        team: false,
        setup: orgPaymentProviders.some((p) => p.status === 'ACTIVE'),
        completed: org.isOnboarded,
      },
    };
  }

  // ── POST /v1/onboarding/submit ────────────────────────────────────────────

  @Post('submit')
  async submit(
    @Ctx() ctx: { orgId: string; userId: string },
    @Body()
    body: {
      workspace: {
        name: string;
        timezone: string;
        currency: string;
        pickupAddress?: string;
      };
      channels: { selected: string[]; connected: string[] };
      team: { email: string; role: string; name?: string }[];
      providers: { payment: string[]; courier: string[] };
    },
  ) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Update workspace
      await queryRunner.manager.update(
        OrganizationEntity,
        { id: ctx.orgId },
        {
          name: body.workspace.name?.trim(),
          timezone: body.workspace.timezone,
          currency: body.workspace.currency,
          ...(body.workspace.pickupAddress !== undefined
            ? { pickupAddress: body.workspace.pickupAddress }
            : {}),
        },
      );

      // 2. Channels — mark selected as PENDING if not yet connected
      if (body.channels?.selected?.length) {
        for (const type of body.channels.selected) {
          const existing = await queryRunner.manager.findOne(ChannelEntity, {
            where: { orgId: ctx.orgId, type } as any,
          });
          if (!existing) {
            await queryRunner.manager.save(
              ChannelEntity,
              queryRunner.manager.create(ChannelEntity, {
                orgId: ctx.orgId,
                type,
                status: 'PENDING',
              }),
            );
          }
        }
      }

      // 3. Team invites — create users with temp passwords
      if (body.team?.length) {
        for (const invite of body.team.filter((m) => m.email?.trim())) {
          const email = invite.email.trim().toLowerCase();
          const existing = await queryRunner.manager.findOne(UserEntity, {
            where: { email, orgId: ctx.orgId } as any,
          });

          if (!existing) {
            const tempPassword = `${crypto.randomBytes(3).toString('hex').toUpperCase()}-${Math.floor(10000 + Math.random() * 90000)}`;
            await queryRunner.manager.save(
              UserEntity,
              queryRunner.manager.create(UserEntity, {
                orgId: ctx.orgId,
                email,
                name: invite.name?.trim() ?? email.split('@')[0],
                role: invite.role?.toUpperCase() ?? 'AGENT',
                status: 'invited',
                passwordHash: crypto
                  .createHash('sha256')
                  .update(tempPassword)
                  .digest('hex'),
                tempPassword,
                isActive: true,
              } as any),
            );
            this.logger.log(
              `[DEV] Invited ${email} — temp password: ${tempPassword}`,
            );
          }
        }
      }

      // 4. Payment providers
      if (body.providers?.payment?.length) {
        await queryRunner.manager.update(
          PaymentProviderEntity,
          { orgId: ctx.orgId },
          { status: 'inactive' },
        );
        await queryRunner.manager.update(
          PaymentProviderEntity,
          { orgId: ctx.orgId, type: In(body.providers.payment) },
          { status: 'active' },
        );
      }

      // 5. Mark onboarded
      await queryRunner.manager.update(
        OrganizationEntity,
        { id: ctx.orgId },
        { isOnboarded: true },
      );

      await queryRunner.commitTransaction();
      return { ok: true, orgId: ctx.orgId };
    } catch (e: any) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Onboarding submit failed', e?.message, e?.stack);
      throw new InternalServerErrorException(
        'Onboarding could not be completed. Please try again.',
      );
    } finally {
      await queryRunner.release();
    }
  }

  // ── POST /v1/onboarding/complete (legacy) ────────────────────────────────

  @Post('complete')
  async complete(@Ctx() ctx: { orgId: string }) {
    await this.orgs.update(
      { id: ctx.orgId } as any,
      { isOnboarded: true } as any,
    );
    return { ok: true, orgId: ctx.orgId };
  }
}
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// import { Ctx } from '@app/common';
// import * as crypto from 'crypto';
// import {
//   Controller,
//   Post,
//   Get,
//   Body,
//   UseGuards,
//   InternalServerErrorException,
//   Logger,
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { DataSource, In, Repository } from 'typeorm';
// import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
// import { ChannelEntity } from '../../inbox/entities/channel.entity';
// import { PaymentProviderEntity } from '../../payments/entities/payment-provider.entity';
// import { OrganizationEntity } from '../../tenancy/entities/organization.entity';
// import { UserEntity } from '../../tenancy/entities/user.entity';

// @Controller('v1/onboarding')
// @UseGuards(JwtAuthGuard)
// export class OnboardingController {
//   private readonly logger = new Logger(OnboardingController.name);

//   constructor(
//     private readonly dataSource: DataSource,
//     @InjectRepository(OrganizationEntity)
//     private orgs: Repository<OrganizationEntity>,
//     @InjectRepository(ChannelEntity)
//     private channels: Repository<ChannelEntity>,
//     @InjectRepository(PaymentProviderEntity)
//     private paymentProviders: Repository<PaymentProviderEntity>,
//   ) {}

//   // ── GET /v1/onboarding/state ──────────────────────────────────────────────
//   @Get('state')
//   async state(@Ctx() ctx: { orgId: string }) {
//     this.logger.log('onboarding state hit');

//     const org = await this.orgs.findOneOrFail({
//       where: { id: ctx.orgId } as any,
//     });

//     const channels = await this.channels.find({
//       where: { orgId: ctx.orgId } as any,
//     });

//     const paymentProviders = await this.paymentProviders.find({
//       where: { orgId: ctx.orgId } as any,
//       order: { name: 'ASC' as any },
//     });

//     return {
//       org: {
//         id: org.id,
//         name: org.name,
//         timezone: org.timezone,
//         currency: org.currency,
//         pickupAddress: org.pickupAddress,
//         isOnboarded: org.isOnboarded,
//       },
//       channels: channels.map((c) => ({
//         id: c.id,
//         type: c.type,
//         name: c.pageId ?? c.externalAccountId ?? c.type,
//         status: c.status === 'ACTIVE' ? 'connected' : 'disconnected',
//         connectedAt: c.createdAt,
//       })),
//       paymentProviders: paymentProviders.map((p) => ({
//         id: p.id,
//         type: p.type,
//         name: p.name,
//         status: p.status,
//       })),
//       courierProviders: [], // not implemented yet
//       progress: {
//         workspace: Boolean(org.name),
//         channels: channels.some((c) => c.status === 'ACTIVE'),
//         team: false,
//         setup: paymentProviders.some((p) => p.status === 'active'),
//         completed: org.isOnboarded,
//       },
//     };
//   }

//   // ── POST /v1/onboarding/submit ────────────────────────────────────────────
//   @Post('submit')
//   async submit(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Body()
//     body: {
//       workspace: {
//         name: string;
//         timezone: string;
//         currency: string;
//       };
//       channels: {
//         selected: string[]; // channel types org intends to use
//         connected: string[]; // channel types that completed OAuth
//       };
//       team: {
//         email: string;
//         role: string;
//       }[];
//       providers: {
//         payment: string[]; // active payment provider types e.g. ["bkash", "nagad"]
//         courier: string[]; // active courier types — stored for future use
//       };
//     },
//   ) {
//     const queryRunner = this.dataSource.createQueryRunner();
//     await queryRunner.connect();
//     await queryRunner.startTransaction();

//     try {
//       // ── 1. Update workspace fields ────────────────────────────────────────
//       await queryRunner.manager.update(
//         OrganizationEntity,
//         { id: ctx.orgId },
//         {
//           name: body.workspace.name?.trim(),
//           timezone: body.workspace.timezone,
//           currency: body.workspace.currency,
//         },
//       );

//       // ── 2. Channels — mark selected types as PENDING if not yet connected.
//       //    Connected ones are already handled by OAuth endpoints so we leave
//       //    them alone. This just ensures selected-but-not-connected types
//       //    exist as rows so the state endpoint can reflect intent.
//       if (body.channels?.selected?.length) {
//         for (const type of body.channels.selected) {
//           const existing = await queryRunner.manager.findOne(ChannelEntity, {
//             where: { orgId: ctx.orgId, type } as any,
//           });

//           if (!existing) {
//             const pending = queryRunner.manager.create(ChannelEntity, {
//               orgId: ctx.orgId,
//               type,
//               status: 'PENDING', // not yet connected — awaiting OAuth
//             });
//             await queryRunner.manager.save(ChannelEntity, pending);
//           }
//           // if already exists (connected or needs_reconnect), leave it as-is
//         }
//       }

//       // ── 3. Bulk invite team members ───────────────────────────────────────
//       if (body.team?.length) {
//         const validInvites = body.team.filter((m) => m.email?.trim());

//         for (const invite of validInvites) {
//           const existing = await queryRunner.manager.findOne(UserEntity, {
//             where: { email: invite.email.trim(), orgId: ctx.orgId } as any,
//           });

//           if (!existing) {
//             const member = queryRunner.manager.create(UserEntity, {
//               orgId: ctx.orgId,
//               email: invite.email.trim(),
//               role: invite.role,
//               status: 'invited',
//               // Random placeholder — they'll set real password via invite email link
//               passwordHash: crypto.randomBytes(32).toString('hex'),
//             });
//             await queryRunner.manager.save(UserEntity, member);
//           }
//         }
//       }
//       if (body.providers?.payment?.length) {
//         await queryRunner.manager.update(
//           PaymentProviderEntity,
//           { orgId: ctx.orgId },
//           { status: 'inactive' },
//         );

//         await queryRunner.manager.update(
//           PaymentProviderEntity,
//           {
//             orgId: ctx.orgId,
//             type: In(body.providers.payment),
//           },
//           { status: 'active' },
//         );
//       }

//       // ── 5. Flip isOnboarded ───────────────────────────────────────────────
//       await queryRunner.manager.update(
//         OrganizationEntity,
//         { id: ctx.orgId },
//         { isOnboarded: true },
//       );

//       await queryRunner.commitTransaction();

//       return { ok: true };
//     } catch (e) {
//       await queryRunner.rollbackTransaction();
//       this.logger.error('Onboarding submit failed', e?.message, e?.stack);
//       throw new InternalServerErrorException(
//         'Onboarding could not be completed. Please try again.',
//       );
//     } finally {
//       await queryRunner.release();
//     }
//   }

//   // ── POST /v1/onboarding/complete (legacy — keep for backwards compat) ─────
//   @Post('complete')
//   async complete(@Ctx() ctx: { orgId: string }) {
//     await this.orgs.update(
//       { id: ctx.orgId } as any,
//       { isOnboarded: true } as any,
//     );
//     return { ok: true };
//   }
// }

// // /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// // import { Ctx } from '@app/common';
// // import { Controller, UseGuards, Get, Post, Logger } from '@nestjs/common';
// // import { InjectRepository } from '@nestjs/typeorm';
// // import { Repository } from 'typeorm';
// // import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
// // import { ChannelEntity } from '../../inbox/entities/channel.entity';
// // import { PaymentProviderEntity } from '../../payments/entities/payment-provider.entity';
// // import { OrganizationEntity } from '../../tenancy/entities/organization.entity';

// // @Controller('v1/onboarding')
// // @UseGuards(JwtAuthGuard)
// // export class OnboardingController {
// //   private readonly logger = new Logger();
// //   constructor(
// //     @InjectRepository(OrganizationEntity)
// //     private orgs: Repository<OrganizationEntity>,
// //     @InjectRepository(ChannelEntity)
// //     private channels: Repository<ChannelEntity>,
// //     @InjectRepository(PaymentProviderEntity)
// //     private paymentProviders: Repository<PaymentProviderEntity>,
// //   ) {}

// //   @Get('state')
// //   async state(@Ctx() ctx: { orgId: string }) {
// //     this.logger.log('on boarding state hit');
// //     const org = await this.orgs.findOneOrFail({
// //       where: { id: ctx.orgId } as any,
// //     });

// //     const channels = await this.channels.find({
// //       where: { orgId: ctx.orgId } as any,
// //     });

// //     const paymentProviders = await this.paymentProviders.find({
// //       where: { orgId: ctx.orgId } as any,
// //       order: { name: 'ASC' as any },
// //     });

// //     // couriers not implemented yet
// //     const courierProviders: any[] = [];

// //     return {
// //       org: {
// //         id: org.id,
// //         name: org.name,
// //         timezone: org.timezone,
// //         currency: org.currency,
// //         pickupAddress: org.pickupAddress,
// //         isOnboarded: org.isOnboarded,
// //       },
// //       channels: channels.map((c) => ({
// //         id: c.id,
// //         type: c.type, // map to UI type later
// //         name: c.pageId ?? c.externalAccountId ?? c.type,
// //         status: c.status === 'ACTIVE' ? 'connected' : 'disconnected',
// //         connectedAt: c.createdAt,
// //       })),
// //       paymentProviders: paymentProviders.map((p) => ({
// //         id: p.id,
// //         type: p.type,
// //         name: p.name,
// //         status: p.status,
// //       })),
// //       courierProviders,
// //       progress: {
// //         workspace: Boolean(org.name),
// //         channels: channels.some((c) => c.status === 'ACTIVE'),
// //         team: false,
// //         setup: paymentProviders.some((p) => p.status === 'active'),
// //         completed: org.isOnboarded,
// //       },
// //     };
// //   }

// //   @Post('complete')
// //   async complete(@Ctx() ctx: { orgId: string }) {
// //     await this.orgs.update(
// //       { id: ctx.orgId } as any,
// //       { isOnboarded: true } as any,
// //     );
// //     return { ok: true };
// //   }
// // }
