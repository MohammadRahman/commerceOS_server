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
