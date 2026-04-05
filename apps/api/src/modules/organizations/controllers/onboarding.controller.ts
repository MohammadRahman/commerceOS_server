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
import {
  ChannelEntity,
  ChannelType,
} from '../../inbox/entities/channel.entity';
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
        // ── ADDED: expose featureFlags (contains persona) to frontend ──────
        featureFlags: org.featureFlags ?? {},
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
        config: undefined,
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
      // ── ADDED: persona + any other flags from onboarding ─────────────────
      // Stored in the existing featureFlags JSONB column — no migration needed.
      // Example value: { persona: "SOCIAL_SELLER", countryCode: "BD" }
      featureFlags?: Record<string, unknown>;
    },
  ) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Update workspace (name, timezone, currency)
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

      // ── ADDED: 1b. Persist featureFlags (persona, region, etc.) ──────────
      // We merge with any existing flags so platform-admin overrides are not
      // wiped out by a re-submission (e.g. if the user goes back through
      // onboarding after an admin has set feature flags).
      if (body.featureFlags && Object.keys(body.featureFlags).length > 0) {
        const org = await queryRunner.manager.findOne(OrganizationEntity, {
          where: { id: ctx.orgId } as any,
        });
        const existing = (org?.featureFlags as Record<string, unknown>) ?? {};
        await queryRunner.manager.update(
          OrganizationEntity,
          { id: ctx.orgId },
          // Spread order: existing admin flags first, then onboarding flags
          // so persona/region set here don't override admin-set flags.
          { featureFlags: { ...body.featureFlags, ...existing } } as any,
        );
      }

      // 2. Channels — create PENDING rows for selected types
      if (body.channels?.selected?.length) {
        for (const typeStr of body.channels.selected) {
          const channelType = typeStr as ChannelType;
          const existing = await queryRunner.manager.findOne(ChannelEntity, {
            where: { orgId: ctx.orgId, type: channelType } as any,
          });
          if (!existing) {
            await queryRunner.manager.save(
              ChannelEntity,
              queryRunner.manager.create(ChannelEntity, {
                orgId: ctx.orgId,
                type: channelType,
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

      // 5. Mark onboarded + start trial clock
      // trial_started_at was null — set it now so the 7-day trial begins
      // when onboarding completes, not at registration.
      // Only set if not already running (safe for re-submission).
      const orgForTrial = await queryRunner.manager.findOne(
        OrganizationEntity,
        {
          where: { id: ctx.orgId } as any,
        },
      );
      await queryRunner.manager.update(OrganizationEntity, { id: ctx.orgId }, {
        isOnboarded: true,
        ...(orgForTrial?.trialStartedAt == null
          ? { trialStartedAt: new Date() }
          : {}),
      } as any);

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
/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
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
// import {
//   ChannelEntity,
//   ChannelType,
// } from '../../inbox/entities/channel.entity';
// import { PaymentProviderEntity } from '../../payments/entities/payment-provider.entity';
// import { OrgCourierProviderEntity } from '../../providers/entities/org-courier-provider.entity';
// import { OrgPaymentProviderEntity } from '../../providers/entities/org-payment-provider.entity';
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
//     @InjectRepository(OrgPaymentProviderEntity)
//     private orgPayments: Repository<OrgPaymentProviderEntity>,
//     @InjectRepository(OrgCourierProviderEntity)
//     private orgCouriers: Repository<OrgCourierProviderEntity>,
//   ) {}

//   // ── GET /v1/onboarding/state ──────────────────────────────────────────────

//   @Get('state')
//   async state(@Ctx() ctx: { orgId: string }) {
//     const [org, channels, orgPaymentProviders, orgCourierProviders] =
//       await Promise.all([
//         this.orgs.findOneOrFail({ where: { id: ctx.orgId } as any }),
//         this.channels.find({ where: { orgId: ctx.orgId } as any }),
//         this.orgPayments.find({ where: { orgId: ctx.orgId } as any }),
//         this.orgCouriers.find({ where: { orgId: ctx.orgId } as any }),
//       ]);

//     return {
//       org: {
//         id: org.id,
//         name: org.name,
//         timezone: org.timezone,
//         currency: org.currency,
//         pickupAddress: org.pickupAddress,
//         plan: org.plan,
//         isOnboarded: org.isOnboarded,
//       },
//       channels: channels.map((c) => ({
//         id: c.id,
//         type: c.type,
//         name: c.pageId ?? c.externalAccountId ?? c.type,
//         status: c.status === 'ACTIVE' ? 'connected' : 'disconnected',
//         connectedAt: c.createdAt,
//       })),
//       paymentProviders: orgPaymentProviders.map((p) => ({
//         id: p.id,
//         type: p.type,
//         name: p.type,
//         status: p.status,
//         config: undefined, // never expose config to frontend
//       })),
//       courierProviders: orgCourierProviders.map((c) => ({
//         id: c.id,
//         type: c.type,
//         name: c.type,
//         status: c.status,
//         config: undefined,
//       })),
//       progress: {
//         workspace: Boolean(org.name),
//         channels: channels.some((c) => c.status === 'ACTIVE'),
//         team: false,
//         setup: orgPaymentProviders.some((p) => p.status === 'ACTIVE'),
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
//         pickupAddress?: string;
//       };
//       channels: { selected: string[]; connected: string[] };
//       team: { email: string; role: string; name?: string }[];
//       providers: { payment: string[]; courier: string[] };
//     },
//   ) {
//     const queryRunner = this.dataSource.createQueryRunner();
//     await queryRunner.connect();
//     await queryRunner.startTransaction();

//     try {
//       // 1. Update workspace
//       await queryRunner.manager.update(
//         OrganizationEntity,
//         { id: ctx.orgId },
//         {
//           name: body.workspace.name?.trim(),
//           timezone: body.workspace.timezone,
//           currency: body.workspace.currency,
//           ...(body.workspace.pickupAddress !== undefined
//             ? { pickupAddress: body.workspace.pickupAddress }
//             : {}),
//         },
//       );

//       if (body.channels?.selected?.length) {
//         for (const typeStr of body.channels.selected) {
//           // Cast string to ChannelType enum — unknown values are stored as-is
//           const channelType = typeStr as ChannelType;
//           const existing = await queryRunner.manager.findOne(ChannelEntity, {
//             where: { orgId: ctx.orgId, type: channelType } as any,
//           });
//           if (!existing) {
//             await queryRunner.manager.save(
//               ChannelEntity,
//               queryRunner.manager.create(ChannelEntity, {
//                 orgId: ctx.orgId,
//                 type: channelType,
//                 status: 'PENDING',
//               }),
//             );
//           }
//         }
//       }

//       // 3. Team invites — create users with temp passwords
//       if (body.team?.length) {
//         for (const invite of body.team.filter((m) => m.email?.trim())) {
//           const email = invite.email.trim().toLowerCase();
//           const existing = await queryRunner.manager.findOne(UserEntity, {
//             where: { email, orgId: ctx.orgId } as any,
//           });

//           if (!existing) {
//             const tempPassword = `${crypto.randomBytes(3).toString('hex').toUpperCase()}-${Math.floor(10000 + Math.random() * 90000)}`;
//             await queryRunner.manager.save(
//               UserEntity,
//               queryRunner.manager.create(UserEntity, {
//                 orgId: ctx.orgId,
//                 email,
//                 name: invite.name?.trim() ?? email.split('@')[0],
//                 role: invite.role?.toUpperCase() ?? 'AGENT',
//                 status: 'invited',
//                 passwordHash: crypto
//                   .createHash('sha256')
//                   .update(tempPassword)
//                   .digest('hex'),
//                 tempPassword,
//                 isActive: true,
//               } as any),
//             );
//             this.logger.log(
//               `[DEV] Invited ${email} — temp password: ${tempPassword}`,
//             );
//           }
//         }
//       }

//       // 4. Payment providers
//       if (body.providers?.payment?.length) {
//         await queryRunner.manager.update(
//           PaymentProviderEntity,
//           { orgId: ctx.orgId },
//           { status: 'inactive' },
//         );
//         await queryRunner.manager.update(
//           PaymentProviderEntity,
//           { orgId: ctx.orgId, type: In(body.providers.payment) },
//           { status: 'active' },
//         );
//       }

//       // 5. Mark onboarded
//       await queryRunner.manager.update(
//         OrganizationEntity,
//         { id: ctx.orgId },
//         { isOnboarded: true },
//       );

//       await queryRunner.commitTransaction();
//       return { ok: true, orgId: ctx.orgId };
//     } catch (e: any) {
//       await queryRunner.rollbackTransaction();
//       this.logger.error('Onboarding submit failed', e?.message, e?.stack);
//       throw new InternalServerErrorException(
//         'Onboarding could not be completed. Please try again.',
//       );
//     } finally {
//       await queryRunner.release();
//     }
//   }

//   // ── POST /v1/onboarding/complete (legacy) ────────────────────────────────

//   @Post('complete')
//   async complete(@Ctx() ctx: { orgId: string }) {
//     await this.orgs.update(
//       { id: ctx.orgId } as any,
//       { isOnboarded: true } as any,
//     );
//     return { ok: true, orgId: ctx.orgId };
//   }
// }
