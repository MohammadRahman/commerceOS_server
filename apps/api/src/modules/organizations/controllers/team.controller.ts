// v3 with full RBAC and permissionsl
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Ctx } from '@app/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RbacGuard } from '@app/common/guards/rbac.guard';
import { RequirePerm } from '@app/common/decorators/require-perm.decorator';
import {
  UserEntity,
  UserRole,
  UserStatus,
} from '../../tenancy/entities/user.entity';

const TEMP_PASSWORD = '123456';

@Controller('v1/organizations/:orgId/team')
@UseGuards(JwtAuthGuard, RbacGuard)
export class TeamController {
  private readonly logger = new Logger(TeamController.name);

  constructor(
    @InjectRepository(UserEntity)
    private users: Repository<UserEntity>,
  ) {}

  // ── GET — all roles can list ──────────────────────────────────────────────
  @Get()
  @RequirePerm('team:read')
  async list(@Ctx() ctx: { orgId: string }, @Param('orgId') orgId: string) {
    if (ctx.orgId !== orgId) throw new UnauthorizedException();
    const members = await this.users.find({
      where: { orgId, isActive: true } as any,
      order: { createdAt: 'ASC' } as any,
    });
    return { members: members.map((m) => this.toDto(m)) };
  }

  // ── INVITE — OWNER and ADMIN only ─────────────────────────────────────────
  @Post('invite')
  @RequirePerm('team:write')
  async invite(
    @Ctx() ctx: { orgId: string },
    @Param('orgId') orgId: string,
    @Body() body: { email: string; role: string; name?: string },
  ) {
    if (ctx.orgId !== orgId) throw new UnauthorizedException();
    if (!body.email?.trim()) throw new BadRequestException('Email is required');

    const email = body.email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 12);

    const existing = await this.users.findOne({
      where: { orgId, email } as any,
    });
    if (existing) {
      await this.users.update(
        { id: existing.id } as any,
        {
          status: UserStatus.INVITED,
          role: (body.role?.toUpperCase() as UserRole) ?? existing.role,
          passwordHash,
          tempPassword: TEMP_PASSWORD,
        } as any,
      );
      const updated = await this.users.findOneOrFail({
        where: { id: existing.id } as any,
      });
      this.logger.log(
        `[DEV] Re-invited ${email} — temp password: ${TEMP_PASSWORD}`,
      );
      return { member: this.toDto(updated, TEMP_PASSWORD) };
    }

    const role = (body.role?.toUpperCase() as UserRole) ?? UserRole.AGENT;
    // const member = await this.users.save(
    //   this.users.create({
    //     orgId,
    //     email,
    //     name: body.name?.trim() ?? email.split('@')[0],
    //     role,
    //     status: UserStatus.INVITED,
    //     passwordHash,
    //     tempPassword: TEMP_PASSWORD,
    //     isActive: true,
    //   } as any),
    // );
    // this.logger.log(`[DEV] Invited ${email} — temp password: ${TEMP_PASSWORD}`);
    // return { member: this.toDto(member, TEMP_PASSWORD) };
    const member = (await this.users.save(
      this.users.create({
        orgId,
        email,
        name: body.name?.trim() ?? email.split('@')[0],
        role,
        status: UserStatus.INVITED,
        passwordHash,
        tempPassword: TEMP_PASSWORD,
        isActive: true,
      } as any),
    )) as unknown as UserEntity;

    this.logger.log(`[DEV] Invited ${email} — temp password: ${TEMP_PASSWORD}`);
    return { member: this.toDto(member, TEMP_PASSWORD) };
  }

  // ── UPDATE ROLE — OWNER only (team:manage) ────────────────────────────────
  @Patch(':memberId/role')
  @RequirePerm('team:manage')
  async updateRole(
    @Ctx() ctx: { orgId: string },
    @Param('orgId') orgId: string,
    @Param('memberId') memberId: string,
    @Body() body: { role: string },
  ) {
    if (ctx.orgId !== orgId) throw new UnauthorizedException();
    const member = await this.users.findOne({
      where: { id: memberId, orgId } as any,
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === UserRole.OWNER)
      throw new BadRequestException('Cannot change owner role');
    const role = body.role?.toUpperCase() as UserRole;
    if (role === UserRole.OWNER)
      throw new BadRequestException('Cannot assign owner role via API');
    await this.users.update({ id: memberId } as any, { role } as any);
    const updated = await this.users.findOneOrFail({
      where: { id: memberId } as any,
    });
    return { member: this.toDto(updated) };
  }

  // ── DELETE — OWNER and ADMIN only ─────────────────────────────────────────
  @Delete(':memberId')
  @RequirePerm('team:delete')
  async remove(
    @Ctx() ctx: { orgId: string },
    @Param('orgId') orgId: string,
    @Param('memberId') memberId: string,
  ) {
    if (ctx.orgId !== orgId) throw new UnauthorizedException();
    const member = await this.users.findOne({
      where: { id: memberId, orgId } as any,
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === UserRole.OWNER)
      throw new BadRequestException('Cannot remove owner');
    await this.users.update(
      { id: memberId } as any,
      { status: UserStatus.INACTIVE, isActive: false } as any,
    );
    return { ok: true };
  }

  private toDto(m: UserEntity, tempPassword?: string) {
    return {
      id: m.id,
      email: m.email,
      name: m.name ?? m.email.split('@')[0],
      role: m.role.toLowerCase(),
      status: m.status,
      joinedAt: m.createdAt.toISOString(),
      ...(tempPassword ? { tempPassword } : {}),
    };
  }
}
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// import {
//   Body,
//   Controller,
//   Delete,
//   Get,
//   Logger,
//   Param,
//   Patch,
//   Post,
//   UnauthorizedException,
//   NotFoundException,
//   BadRequestException,
//   UseGuards,
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import * as bcrypt from 'bcrypt';
// import { Ctx } from '@app/common';
// import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
// import {
//   UserEntity,
//   UserRole,
//   UserStatus,
// } from '../../tenancy/entities/user.entity';

// const TEMP_PASSWORD = '123456';

// @Controller('v1/organizations/:orgId/team')
// @UseGuards(JwtAuthGuard)
// export class TeamController {
//   private readonly logger = new Logger(TeamController.name);

//   constructor(
//     @InjectRepository(UserEntity)
//     private users: Repository<UserEntity>,
//   ) {}

//   @Get()
//   async list(@Ctx() ctx: { orgId: string }, @Param('orgId') orgId: string) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException();

//     const members = await this.users.find({
//       where: { orgId } as any,
//       order: { createdAt: 'ASC' } as any,
//     });

//     return { members: members.map((m) => this.toDto(m)) };
//   }

//   @Post('invite')
//   async invite(
//     @Ctx() ctx: { orgId: string },
//     @Param('orgId') orgId: string,
//     @Body() body: { email: string; role: string; name?: string },
//   ) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException();
//     if (!body.email?.trim()) throw new BadRequestException('Email is required');

//     const email = body.email.trim().toLowerCase();
//     // bcrypt hash so login works immediately with password "12345"
//     const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 12);

//     const existing = await this.users.findOne({
//       where: { orgId, email } as any,
//     });

//     if (existing) {
//       // Re-invite: reset password back to 12345
//       await this.users.update(
//         { id: existing.id } as any,
//         {
//           status: UserStatus.INVITED,
//           role: (body.role?.toUpperCase() as UserRole) ?? existing.role,
//           passwordHash,
//           tempPassword: TEMP_PASSWORD,
//         } as any,
//       );
//       const updated = await this.users.findOneOrFail({
//         where: { id: existing.id } as any,
//       });
//       this.logger.log(
//         `[DEV] Re-invited ${email} — temp password: ${TEMP_PASSWORD}`,
//       );
//       return { member: this.toDto(updated, TEMP_PASSWORD) };
//     }

//     const role = (body.role?.toUpperCase() as UserRole) ?? UserRole.AGENT;
//     const member = await this.users.save(
//       this.users.create({
//         orgId,
//         email,
//         name: body.name?.trim() ?? email.split('@')[0],
//         role,
//         status: UserStatus.INVITED,
//         passwordHash,
//         tempPassword: TEMP_PASSWORD,
//         isActive: true,
//       } as any),
//     );

//     this.logger.log(`[DEV] Invited ${email} — temp password: ${TEMP_PASSWORD}`);
//     return { member: this.toDto(member, TEMP_PASSWORD) };
//   }

//   @Patch(':memberId/role')
//   async updateRole(
//     @Ctx() ctx: { orgId: string },
//     @Param('orgId') orgId: string,
//     @Param('memberId') memberId: string,
//     @Body() body: { role: string },
//   ) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException();

//     const member = await this.users.findOne({
//       where: { id: memberId, orgId } as any,
//     });
//     if (!member) throw new NotFoundException('Member not found');

//     const role = body.role?.toUpperCase() as UserRole;
//     await this.users.update({ id: memberId } as any, { role } as any);
//     const updated = await this.users.findOneOrFail({
//       where: { id: memberId } as any,
//     });
//     return { member: this.toDto(updated) };
//   }

//   @Delete(':memberId')
//   async remove(
//     @Ctx() ctx: { orgId: string },
//     @Param('orgId') orgId: string,
//     @Param('memberId') memberId: string,
//   ) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException();

//     const member = await this.users.findOne({
//       where: { id: memberId, orgId } as any,
//     });
//     if (!member) throw new NotFoundException('Member not found');

//     await this.users.update(
//       { id: memberId } as any,
//       { status: UserStatus.INACTIVE, isActive: false } as any,
//     );
//     return { ok: true };
//   }

//   private toDto(m: UserEntity, tempPassword?: string) {
//     return {
//       id: m.id,
//       email: m.email,
//       name: m.name ?? m.email.split('@')[0],
//       role: m.role.toLowerCase(),
//       status: m.status,
//       joinedAt: m.createdAt.toISOString(),
//       ...(tempPassword ? { tempPassword } : {}),
//     };
//   }
// }
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// import * as crypto from 'crypto';
// import {
//   Body,
//   Controller,
//   Delete,
//   Get,
//   Logger,
//   Param,
//   Patch,
//   Post,
//   UnauthorizedException,
//   NotFoundException,
//   BadRequestException,
//   UseGuards,
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { Ctx } from '@app/common';
// import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
// import {
//   UserEntity,
//   UserRole,
//   UserStatus,
// } from '../../tenancy/entities/user.entity';

// @Controller('v1/organizations/:orgId/team')
// @UseGuards(JwtAuthGuard)
// export class TeamController {
//   private readonly logger = new Logger(TeamController.name);

//   constructor(
//     @InjectRepository(UserEntity)
//     private users: Repository<UserEntity>,
//   ) {}

//   @Get()
//   async list(@Ctx() ctx: { orgId: string }, @Param('orgId') orgId: string) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException();
//     const members = await this.users.find({
//       where: { orgId } as any,
//       order: { createdAt: 'ASC' } as any,
//     });
//     return { members: members.map((m) => this.toDto(m)) };
//   }

//   @Post('invite')
//   async invite(
//     @Ctx() ctx: { orgId: string },
//     @Param('orgId') orgId: string,
//     @Body() body: { email: string; role: string; name?: string },
//   ) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException();
//     if (!body.email?.trim()) throw new BadRequestException('Email is required');

//     const email = body.email.trim().toLowerCase();
//     const tempPassword = '12345'; // constant for now

//     const existing = await this.users.findOne({
//       where: { orgId, email } as any,
//     });

//     if (existing) {
//       await this.users.update(
//         { id: existing.id } as any,
//         {
//           status: UserStatus.INVITED,
//           role: (body.role?.toUpperCase() as UserRole) ?? existing.role,
//           tempPassword,
//           passwordHash: crypto
//             .createHash('sha256')
//             .update(tempPassword)
//             .digest('hex'),
//         } as any,
//       );
//       const updated = await this.users.findOneOrFail({
//         where: { id: existing.id } as any,
//       });
//       this.logger.log(
//         `[DEV] Re-invited ${email} — temp password: ${tempPassword}`,
//       );
//       return { member: this.toDto(updated, tempPassword) };
//     }

//     const role = (body.role?.toUpperCase() as UserRole) ?? UserRole.AGENT;
//     const member = await this.users.save(
//       this.users.create({
//         orgId,
//         email,
//         name: body.name?.trim() ?? email.split('@')[0],
//         role,
//         status: UserStatus.INVITED,
//         passwordHash: crypto
//           .createHash('sha256')
//           .update(tempPassword)
//           .digest('hex'),
//         tempPassword,
//         isActive: true,
//       } as any),
//     );

//     this.logger.log(`[DEV] Invited ${email} — temp password: ${tempPassword}`);
//     return { member: this.toDto(member, tempPassword) };
//   }

//   @Patch(':memberId/role')
//   async updateRole(
//     @Ctx() ctx: { orgId: string },
//     @Param('orgId') orgId: string,
//     @Param('memberId') memberId: string,
//     @Body() body: { role: string },
//   ) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException();
//     const member = await this.users.findOne({
//       where: { id: memberId, orgId } as any,
//     });
//     if (!member) throw new NotFoundException('Member not found');
//     const role = body.role?.toUpperCase() as UserRole;
//     await this.users.update({ id: memberId } as any, { role } as any);
//     const updated = await this.users.findOneOrFail({
//       where: { id: memberId } as any,
//     });
//     return { member: this.toDto(updated) };
//   }

//   @Delete(':memberId')
//   async remove(
//     @Ctx() ctx: { orgId: string },
//     @Param('orgId') orgId: string,
//     @Param('memberId') memberId: string,
//   ) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException();
//     const member = await this.users.findOne({
//       where: { id: memberId, orgId } as any,
//     });
//     if (!member) throw new NotFoundException('Member not found');
//     await this.users.update(
//       { id: memberId } as any,
//       { status: UserStatus.INACTIVE, isActive: false } as any,
//     );
//     return { ok: true };
//   }

//   private toDto(m: UserEntity, tempPassword?: string) {
//     return {
//       id: m.id,
//       email: m.email,
//       name: m.name ?? m.email.split('@')[0],
//       role: m.role.toLowerCase(),
//       status: m.status,
//       joinedAt: m.createdAt.toISOString(),
//       ...(tempPassword ? { tempPassword } : {}),
//     };
//   }
// }
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// import * as crypto from 'crypto';
// import {
//   Body,
//   Controller,
//   Delete,
//   Get,
//   Logger,
//   Param,
//   Patch,
//   Post,
//   UnauthorizedException,
//   NotFoundException,
//   BadRequestException,
//   UseGuards,
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { Ctx } from '@app/common';
// import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
// import {
//   UserEntity,
//   UserRole,
//   UserStatus,
// } from '../../tenancy/entities/user.entity';

// @Controller('v1/organizations/:orgId/team')
// @UseGuards(JwtAuthGuard)
// export class TeamController {
//   private readonly logger = new Logger(TeamController.name);

//   constructor(
//     @InjectRepository(UserEntity)
//     private users: Repository<UserEntity>,
//   ) {}

//   // ── GET /v1/organizations/:orgId/team ─────────────────────────────────────

//   @Get()
//   async list(@Ctx() ctx: { orgId: string }, @Param('orgId') orgId: string) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException();

//     const members = await this.users.find({
//       where: { orgId } as any,
//       order: { createdAt: 'ASC' } as any,
//     });

//     return {
//       members: members.map((m) => this.toDto(m)),
//     };
//   }

//   // ── POST /v1/organizations/:orgId/team/invite ─────────────────────────────

//   @Post('invite')
//   async invite(
//     @Ctx() ctx: { orgId: string },
//     @Param('orgId') orgId: string,
//     @Body() body: { email: string; role: string; name?: string },
//   ) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException();
//     if (!body.email?.trim()) throw new BadRequestException('Email is required');

//     const email = body.email.trim().toLowerCase();

//     // Check for existing member
//     const existing = await this.users.findOne({
//       where: { orgId, email } as any,
//     });

//     if (existing) {
//       // Re-invite: reset to invited status
//       const tempPassword = this.generateTempPassword();
//       await this.users.update(
//         { id: existing.id } as any,
//         {
//           status: UserStatus.INVITED,
//           role: (body.role?.toUpperCase() as UserRole) ?? existing.role,
//           tempPassword,
//         } as any,
//       );

//       const updated = await this.users.findOneOrFail({
//         where: { id: existing.id } as any,
//       });

//       this.logger.log(
//         `[DEV] Re-invited ${email} — temp password: ${tempPassword}`,
//       );

//       return { member: this.toDto(updated, tempPassword) };
//     }

//     // New invite
//     const tempPassword = this.generateTempPassword();
//     const role = (body.role?.toUpperCase() as UserRole) ?? UserRole.AGENT;

//     const member = await this.users.save(
//       this.users.create({
//         orgId,
//         email,
//         name: body.name?.trim() ?? email.split('@')[0],
//         role,
//         status: UserStatus.INVITED,
//         passwordHash: crypto
//           .createHash('sha256')
//           .update(tempPassword)
//           .digest('hex'),
//         tempPassword, // stored for dev — cleared when email/SMS configured
//         isActive: true,
//       } as any),
//     );

//     this.logger.log(`[DEV] Invited ${email} — temp password: ${tempPassword}`);

//     return { member: this.toDto(member, tempPassword) };
//   }

//   // ── PATCH /v1/organizations/:orgId/team/:memberId/role ────────────────────

//   @Patch(':memberId/role')
//   async updateRole(
//     @Ctx() ctx: { orgId: string },
//     @Param('orgId') orgId: string,
//     @Param('memberId') memberId: string,
//     @Body() body: { role: string },
//   ) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException();

//     const member = await this.users.findOne({
//       where: { id: memberId, orgId } as any,
//     });
//     if (!member) throw new NotFoundException('Member not found');

//     const role = body.role?.toUpperCase() as UserRole;
//     await this.users.update({ id: memberId } as any, { role } as any);

//     const updated = await this.users.findOneOrFail({
//       where: { id: memberId } as any,
//     });

//     return { member: this.toDto(updated) };
//   }

//   // ── DELETE /v1/organizations/:orgId/team/:memberId ────────────────────────

//   @Delete(':memberId')
//   async remove(
//     @Ctx() ctx: { orgId: string },
//     @Param('orgId') orgId: string,
//     @Param('memberId') memberId: string,
//   ) {
//     if (ctx.orgId !== orgId) throw new UnauthorizedException();

//     const member = await this.users.findOne({
//       where: { id: memberId, orgId } as any,
//     });
//     if (!member) throw new NotFoundException('Member not found');

//     // Soft-delete: mark inactive
//     await this.users.update(
//       { id: memberId } as any,
//       { status: UserStatus.INACTIVE, isActive: false } as any,
//     );

//     return { ok: true };
//   }

//   // ── Helpers ───────────────────────────────────────────────────────────────

//   private generateTempPassword(): string {
//     // Format: ABC-12345 — easy to type, 8 chars
//     const letters = crypto
//       .randomBytes(3)
//       .toString('hex')
//       .toUpperCase()
//       .slice(0, 3);
//     const digits = Math.floor(10000 + Math.random() * 90000);
//     return `${letters}-${digits}`;
//   }

//   private toDto(m: UserEntity, tempPassword?: string) {
//     return {
//       id: m.id,
//       email: m.email,
//       name: m.name ?? m.email.split('@')[0],
//       role: m.role.toLowerCase(),
//       status: m.status,
//       joinedAt: m.createdAt.toISOString(),
//       // Only returned on invite for dev/testing — never exposed otherwise
//       ...(tempPassword ? { tempPassword } : {}),
//     };
//   }
// }
