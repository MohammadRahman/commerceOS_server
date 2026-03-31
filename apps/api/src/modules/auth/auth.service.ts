// v3 with OTP-based passwordless login + optional magic link email for backup
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// apps/api/src/modules/auth/auth.service.ts — v4
// v4 changes: isPlatformAdmin included in access token payload for both
//             register() and login() — required by PlatformAdminGuard
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Repository, DeepPartial } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';

import { UserEntity, UserRole } from '../tenancy/entities/user.entity';
import { UserSessionEntity } from '../tenancy/entities/user-session.entity';
import { OrganizationEntity } from '../tenancy/entities/organization.entity';
import { JwtAccessPayload, JwtRefreshPayload } from '@app/common/types/auth';
import { RegisterDto } from './dto/register.dto';
import { EmailService } from '../notifications/services/email.service';
import { SmsService } from '../notifications/services/sms.service';

const RESET_EXPIRES_MINUTES = 60;
const OTP_EXPIRES_MINUTES = 5;
const OTP_LENGTH = 4;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(UserSessionEntity)
    private readonly sessions: Repository<UserSessionEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
  ) {}

  private accessTtlSeconds() {
    return Number(this.config.getOrThrow<string>('JWT_ACCESS_TTL_SECONDS'));
  }
  private refreshTtlSeconds() {
    return Number(this.config.getOrThrow<string>('JWT_REFRESH_TTL_SECONDS'));
  }

  // ─── Register ─────────────────────────────────────────────────────────────

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.users.findOne({ where: { email } });
    if (existing) throw new BadRequestException('Email already registered');

    const org = await this.orgRepo.save(
      this.orgRepo.create({
        name: dto.businessName,
        plan: 'FREE',
      } as DeepPartial<OrganizationEntity>),
    );
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.users.save(
      this.users.create({
        orgId: org.id,
        email,
        passwordHash,
        phone: dto.phone,
        role: UserRole.OWNER,
        isActive: true,
      } as DeepPartial<UserEntity>),
    );

    const sessionId = randomUUID();

    // ── Access token — includes isPlatformAdmin for PlatformAdminGuard ────────
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        orgId: user.orgId,
        role: user.role,
        isPlatformAdmin: user.isPlatformAdmin ?? false, // ← NEW
        jti: randomUUID(),
        typ: 'access',
      } as JwtAccessPayload,
      {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
        expiresIn: this.accessTtlSeconds(),
      },
    );

    const refreshToken = await this.jwt.signAsync(
      {
        sub: user.id,
        orgId: user.orgId,
        sid: sessionId,
        jti: randomUUID(),
        typ: 'refresh',
      } as JwtRefreshPayload,
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: this.refreshTtlSeconds(),
      },
    );
    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);
    await this.sessions.save(
      this.sessions.create({
        id: sessionId,
        orgId: user.orgId,
        userId: user.id,
        refreshTokenHash,
        lastUsedAt: new Date(),
      } as DeepPartial<UserSessionEntity>),
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        orgId: user.orgId,
        email: user.email,
        role: user.role,
        isPlatformAdmin: user.isPlatformAdmin ?? false, // ← NEW
      },
      organization: { id: org.id, name: org.name, plan: org.plan },
      received: {
        ownerName: dto.ownerName,
        phone: dto.phone,
        mainChannel: dto.mainChannel ?? null,
      },
    };
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  async login(params: {
    email: string;
    password: string;
    orgId?: string;
    userAgent?: string;
    ip?: string;
  }) {
    const email = params.email.trim().toLowerCase();
    const { password, orgId, userAgent, ip } = params;
    let user: UserEntity | null = null;
    if (orgId) {
      user = await this.users.findOne({
        where: { orgId, email, isActive: true },
      });
    } else {
      const matches = await this.users.find({
        where: { email, isActive: true },
        take: 2,
      });
      if (matches.length === 0)
        throw new UnauthorizedException('Invalid credentials');
      if (matches.length > 1)
        throw new BadRequestException(
          'Multiple organizations found. Provide orgId.',
        );
      user = matches[0];
    }
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const sessionId = randomUUID();

    // ── Access token — includes isPlatformAdmin for PlatformAdminGuard ────────
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        orgId: user.orgId,
        role: user.role,
        isPlatformAdmin: user.isPlatformAdmin ?? false, // ← NEW
        jti: randomUUID(),
        typ: 'access',
      } as JwtAccessPayload,
      {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
        expiresIn: this.accessTtlSeconds(),
      },
    );

    const refreshToken = await this.jwt.signAsync(
      {
        sub: user.id,
        orgId: user.orgId,
        sid: sessionId,
        jti: randomUUID(),
        typ: 'refresh',
      } as JwtRefreshPayload,
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: this.refreshTtlSeconds(),
      },
    );
    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);
    await this.sessions.save(
      this.sessions.create({
        id: sessionId,
        orgId: user.orgId,
        userId: user.id,
        refreshTokenHash,
        userAgent,
        ip,
        lastUsedAt: new Date(),
      } satisfies DeepPartial<UserSessionEntity>),
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        orgId: user.orgId,
        email: user.email,
        role: user.role,
        isPlatformAdmin: user.isPlatformAdmin ?? false, // ← NEW
      },
    };
  }

  // ─── Refresh ──────────────────────────────────────────────────────────────

  async refresh(params: {
    refreshToken: string;
    userAgent?: string;
    ip?: string;
  }) {
    const { refreshToken, userAgent, ip } = params;
    let payload: JwtRefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtRefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.typ !== 'refresh')
      throw new UnauthorizedException('Invalid refresh token');
    const session = await this.sessions.findOne({
      where: { id: payload.sid, orgId: payload.orgId, userId: payload.sub },
    });
    if (!session || session.revokedAt)
      throw new UnauthorizedException('Session revoked');
    const match = await bcrypt.compare(refreshToken, session.refreshTokenHash);
    if (!match) throw new UnauthorizedException('Invalid refresh token');
    const user = await this.users.findOne({
      where: { id: payload.sub, orgId: payload.orgId, isActive: true },
    });
    if (!user) throw new UnauthorizedException('User disabled');

    // ── Re-issue access token with latest isPlatformAdmin value ───────────────
    // Re-read from DB so if isPlatformAdmin was toggled, next refresh picks it up
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        orgId: user.orgId,
        role: user.role,
        isPlatformAdmin: user.isPlatformAdmin ?? false, // ← NEW
        jti: randomUUID(),
        typ: 'access',
      } as JwtAccessPayload,
      {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
        expiresIn: this.accessTtlSeconds(),
      },
    );
    const newRefreshToken = await this.jwt.signAsync(
      {
        sub: user.id,
        orgId: user.orgId,
        sid: session.id,
        jti: randomUUID(),
        typ: 'refresh',
      } as JwtRefreshPayload,
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: this.refreshTtlSeconds(),
      },
    );
    const newHash = await bcrypt.hash(newRefreshToken, 12);
    await this.sessions.update(
      { id: session.id },
      { refreshTokenHash: newHash, lastUsedAt: new Date(), userAgent, ip },
    );
    return { accessToken, refreshToken: newRefreshToken };
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  async logout(params: { orgId: string; userId: string; sessionId?: string }) {
    const { orgId, userId, sessionId } = params;
    if (sessionId) {
      await this.sessions.update(
        { id: sessionId, orgId, userId },
        { revokedAt: new Date() },
      );
      return;
    }
    await this.sessions.update(
      { orgId, userId, revokedAt: null as any },
      { revokedAt: new Date() },
    );
  }

  // ─── Me ───────────────────────────────────────────────────────────────────

  async me(ctx: { userId: string; orgId: string }) {
    const user = await this.users.findOne({ where: { id: ctx.userId } as any });
    if (!user) throw new NotFoundException('User not found');
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        orgId: user.orgId,
        isPlatformAdmin: user.isPlatformAdmin ?? false, // ← NEW
      },
    };
  }

  // ─── Forgot Password — Email (magic link) ────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.users.findOne({
      where: { email: normalizedEmail, isActive: true },
    });
    if (!user) {
      this.logger.log(
        `[Auth] Forgot password: email not found (${normalizedEmail}) — silent return`,
      );
      return;
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_EXPIRES_MINUTES * 60 * 1000);
    await this.users.update(
      { id: user.id },
      { resetPasswordToken: tokenHash, resetPasswordExpiresAt: expiresAt },
    );

    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'https://commerceos.xenlo.app';
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(normalizedEmail)}`;
    const displayName = user.name ?? normalizedEmail.split('@')[0];

    try {
      await this.email.sendPasswordResetLink({
        to: normalizedEmail,
        name: displayName,
        resetUrl,
        expiresInMinutes: RESET_EXPIRES_MINUTES,
      });
    } catch (err) {
      this.logger.error('[Auth] Failed to send reset email', err);
    }

    if (user.phone) {
      try {
        await this.sms.sendPasswordResetLink({
          to: user.phone,
          name: displayName,
          resetUrl,
          expiresInMinutes: RESET_EXPIRES_MINUTES,
        });
      } catch (err) {
        this.logger.error('[Auth] Failed to send reset SMS', err);
      }
    }
  }

  // ─── Forgot Password — Phone (OTP) ───────────────────────────────────────

  async forgotPasswordByPhone(phone: string, email: string): Promise<void> {
    const normalizedPhone = phone.trim();
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.users.findOne({
      where: { phone: normalizedPhone, email: normalizedEmail, isActive: true },
    });

    if (!user) {
      this.logger.log(
        `[Auth] OTP: phone not found (${normalizedPhone}) — silent return`,
      );
      return;
    }

    const otp = Array.from({ length: OTP_LENGTH }, () =>
      Math.floor(Math.random() * 10),
    ).join('');
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);

    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[Auth] DEV OTP for ${normalizedPhone}: ${otp}`);
    }
    await this.users.update(
      { id: user.id },
      { otpHash, otpExpiresAt: expiresAt },
    );

    const displayName = user.name ?? normalizedPhone;

    try {
      await this.sms.sendOtp({
        to: normalizedPhone,
        name: displayName,
        otp,
        expiresInMinutes: OTP_EXPIRES_MINUTES,
      });
    } catch (err) {
      this.logger.error('[Auth] Failed to send OTP SMS', err);
    }
  }

  // ─── Verify OTP ───────────────────────────────────────────────────────────

  async verifyOtp(params: {
    phone: string;
    email: string;
    otp: string;
  }): Promise<{ valid: boolean; resetToken?: string }> {
    const { phone, otp, email } = params;
    const normalizedPhone = phone.trim();

    const user = await this.users.findOne({
      where: {
        phone: normalizedPhone,
        email: email.trim().toLowerCase(),
        isActive: true,
      },
    });
    if (!user || !user.otpHash || !user.otpExpiresAt) return { valid: false };
    if (user.otpExpiresAt < new Date()) {
      await this.users.update(
        { id: user.id },
        { otpHash: undefined, otpExpiresAt: undefined },
      );
      return { valid: false };
    }

    const match = await bcrypt.compare(otp, user.otpHash);
    if (!match) return { valid: false };

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.users.update(
      { id: user.id },
      {
        resetPasswordToken: tokenHash,
        resetPasswordExpiresAt: expiresAt,
        otpHash: undefined,
        otpExpiresAt: undefined,
      },
    );

    return { valid: true, resetToken: rawToken };
  }

  // ─── Verify Reset Token (magic link) ─────────────────────────────────────

  async verifyResetToken(params: {
    email: string;
    token: string;
  }): Promise<{ valid: boolean }> {
    const { email, token } = params;
    const normalizedEmail = email.trim().toLowerCase();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const user = await this.users.findOne({
      where: { email: normalizedEmail, resetPasswordToken: tokenHash },
    });
    if (
      !user ||
      !user.resetPasswordExpiresAt ||
      user.resetPasswordExpiresAt < new Date()
    )
      return { valid: false };
    return { valid: true };
  }

  // ─── Reset Password ───────────────────────────────────────────────────────

  async resetPassword(params: {
    email?: string;
    phone?: string;
    token: string;
    newPassword: string;
  }): Promise<void> {
    const { token, newPassword } = params;
    const tokenHash = createHash('sha256').update(token).digest('hex');

    let user: UserEntity | null = null;
    if (params.email) {
      user = await this.users.findOne({
        where: {
          email: params.email.trim().toLowerCase(),
          resetPasswordToken: tokenHash,
        },
      });
    } else if (params.phone) {
      user = await this.users.findOne({
        where: { phone: params.phone.trim(), resetPasswordToken: tokenHash },
      });
    }

    if (!user) throw new BadRequestException('Invalid or expired reset link');
    if (
      !user.resetPasswordExpiresAt ||
      user.resetPasswordExpiresAt < new Date()
    ) {
      await this.users.update(
        { id: user.id },
        { resetPasswordToken: undefined, resetPasswordExpiresAt: undefined },
      );
      throw new BadRequestException(
        'Reset link has expired. Please request a new one.',
      );
    }
    if (newPassword.length < 8)
      throw new BadRequestException('Password must be at least 8 characters');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.users.update(
      { id: user.id },
      {
        passwordHash,
        resetPasswordToken: undefined,
        resetPasswordExpiresAt: undefined,
      },
    );
    await this.sessions.update(
      { orgId: user.orgId, userId: user.id, revokedAt: null as any },
      { revokedAt: new Date() },
    );
    this.logger.log(`[Auth] Password reset successful for user ${user.id}`);
  }
}
// // v3 with OTP-based passwordless login + optional magic link email for backup
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// // apps/api/src/modules/auth/auth.service.ts — v3
// // Adds: forgotPasswordByPhone (OTP), verifyOtp, resetPasswordWithOtp
// import {
//   Injectable,
//   UnauthorizedException,
//   BadRequestException,
//   Logger,
//   NotFoundException,
// } from '@nestjs/common';
// import { JwtService } from '@nestjs/jwt';
// import { ConfigService } from '@nestjs/config';
// import { Repository, DeepPartial } from 'typeorm';
// import { InjectRepository } from '@nestjs/typeorm';
// import * as bcrypt from 'bcrypt';
// import { createHash, randomBytes, randomUUID } from 'crypto';

// import { UserEntity, UserRole } from '../tenancy/entities/user.entity';
// import { UserSessionEntity } from '../tenancy/entities/user-session.entity';
// import { OrganizationEntity } from '../tenancy/entities/organization.entity';
// import { JwtAccessPayload, JwtRefreshPayload } from '@app/common/types/auth';
// import { RegisterDto } from './dto/register.dto';
// import { EmailService } from '../notifications/services/email.service';
// import { SmsService } from '../notifications/services/sms.service';

// const RESET_EXPIRES_MINUTES = 60;
// const OTP_EXPIRES_MINUTES = 5;
// const OTP_LENGTH = 4;

// @Injectable()
// export class AuthService {
//   private readonly logger = new Logger(AuthService.name);

//   constructor(
//     private readonly jwt: JwtService,
//     private readonly config: ConfigService,
//     private readonly email: EmailService,
//     private readonly sms: SmsService,
//     @InjectRepository(UserEntity)
//     private readonly users: Repository<UserEntity>,
//     @InjectRepository(UserSessionEntity)
//     private readonly sessions: Repository<UserSessionEntity>,
//     @InjectRepository(OrganizationEntity)
//     private readonly orgRepo: Repository<OrganizationEntity>,
//   ) {}

//   private accessTtlSeconds() {
//     return Number(this.config.getOrThrow<string>('JWT_ACCESS_TTL_SECONDS'));
//   }
//   private refreshTtlSeconds() {
//     return Number(this.config.getOrThrow<string>('JWT_REFRESH_TTL_SECONDS'));
//   }

//   // ─── Register ─────────────────────────────────────────────────────────────

//   async register(dto: RegisterDto) {
//     const email = dto.email.trim().toLowerCase();
//     const existing = await this.users.findOne({ where: { email } });
//     if (existing) throw new BadRequestException('Email already registered');

//     const org = await this.orgRepo.save(
//       this.orgRepo.create({
//         name: dto.businessName,
//         plan: 'FREE',
//       } as DeepPartial<OrganizationEntity>),
//     );
//     const passwordHash = await bcrypt.hash(dto.password, 12);
//     const user = await this.users.save(
//       this.users.create({
//         orgId: org.id,
//         email,
//         passwordHash,
//         phone: dto.phone,
//         role: UserRole.OWNER,
//         isActive: true,
//       } as DeepPartial<UserEntity>),
//     );

//     const sessionId = randomUUID();
//     const accessToken = await this.jwt.signAsync(
//       {
//         sub: user.id,
//         orgId: user.orgId,
//         role: user.role,
//         jti: randomUUID(),
//         typ: 'access',
//       } as JwtAccessPayload,
//       {
//         secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
//         expiresIn: this.accessTtlSeconds(),
//       },
//     );
//     const refreshToken = await this.jwt.signAsync(
//       {
//         sub: user.id,
//         orgId: user.orgId,
//         sid: sessionId,
//         jti: randomUUID(),
//         typ: 'refresh',
//       } as JwtRefreshPayload,
//       {
//         secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
//         expiresIn: this.refreshTtlSeconds(),
//       },
//     );
//     const refreshTokenHash = await bcrypt.hash(refreshToken, 12);
//     await this.sessions.save(
//       this.sessions.create({
//         id: sessionId,
//         orgId: user.orgId,
//         userId: user.id,
//         refreshTokenHash,
//         lastUsedAt: new Date(),
//       } as DeepPartial<UserSessionEntity>),
//     );

//     return {
//       accessToken,
//       refreshToken,
//       user: {
//         id: user.id,
//         orgId: user.orgId,
//         email: user.email,
//         role: user.role,
//       },
//       organization: { id: org.id, name: org.name, plan: org.plan },
//       received: {
//         ownerName: dto.ownerName,
//         phone: dto.phone,
//         mainChannel: dto.mainChannel ?? null,
//       },
//     };
//   }

//   // ─── Login ────────────────────────────────────────────────────────────────

//   async login(params: {
//     email: string;
//     password: string;
//     orgId?: string;
//     userAgent?: string;
//     ip?: string;
//   }) {
//     const email = params.email.trim().toLowerCase();
//     const { password, orgId, userAgent, ip } = params;
//     let user: UserEntity | null = null;
//     if (orgId) {
//       user = await this.users.findOne({
//         where: { orgId, email, isActive: true },
//       });
//     } else {
//       const matches = await this.users.find({
//         where: { email, isActive: true },
//         take: 2,
//       });
//       if (matches.length === 0)
//         throw new UnauthorizedException('Invalid credentials');
//       if (matches.length > 1)
//         throw new BadRequestException(
//           'Multiple organizations found. Provide orgId.',
//         );
//       user = matches[0];
//     }
//     if (!user) throw new UnauthorizedException('Invalid credentials');
//     const ok = await bcrypt.compare(password, user.passwordHash);
//     if (!ok) throw new UnauthorizedException('Invalid credentials');

//     const sessionId = randomUUID();
//     const accessToken = await this.jwt.signAsync(
//       {
//         sub: user.id,
//         orgId: user.orgId,
//         role: user.role,
//         jti: randomUUID(),
//         typ: 'access',
//       } as JwtAccessPayload,
//       {
//         secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
//         expiresIn: this.accessTtlSeconds(),
//       },
//     );
//     const refreshToken = await this.jwt.signAsync(
//       {
//         sub: user.id,
//         orgId: user.orgId,
//         sid: sessionId,
//         jti: randomUUID(),
//         typ: 'refresh',
//       } as JwtRefreshPayload,
//       {
//         secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
//         expiresIn: this.refreshTtlSeconds(),
//       },
//     );
//     const refreshTokenHash = await bcrypt.hash(refreshToken, 12);
//     await this.sessions.save(
//       this.sessions.create({
//         id: sessionId,
//         orgId: user.orgId,
//         userId: user.id,
//         refreshTokenHash,
//         userAgent,
//         ip,
//         lastUsedAt: new Date(),
//       } satisfies DeepPartial<UserSessionEntity>),
//     );
//     return {
//       accessToken,
//       refreshToken,
//       user: {
//         id: user.id,
//         orgId: user.orgId,
//         email: user.email,
//         role: user.role,
//       },
//     };
//   }

//   // ─── Refresh ──────────────────────────────────────────────────────────────

//   async refresh(params: {
//     refreshToken: string;
//     userAgent?: string;
//     ip?: string;
//   }) {
//     const { refreshToken, userAgent, ip } = params;
//     let payload: JwtRefreshPayload;
//     try {
//       payload = await this.jwt.verifyAsync<JwtRefreshPayload>(refreshToken, {
//         secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
//       });
//     } catch {
//       throw new UnauthorizedException('Invalid refresh token');
//     }
//     if (payload.typ !== 'refresh')
//       throw new UnauthorizedException('Invalid refresh token');
//     const session = await this.sessions.findOne({
//       where: { id: payload.sid, orgId: payload.orgId, userId: payload.sub },
//     });
//     if (!session || session.revokedAt)
//       throw new UnauthorizedException('Session revoked');
//     const match = await bcrypt.compare(refreshToken, session.refreshTokenHash);
//     if (!match) throw new UnauthorizedException('Invalid refresh token');
//     const user = await this.users.findOne({
//       where: { id: payload.sub, orgId: payload.orgId, isActive: true },
//     });
//     if (!user) throw new UnauthorizedException('User disabled');

//     const accessToken = await this.jwt.signAsync(
//       {
//         sub: user.id,
//         orgId: user.orgId,
//         role: user.role,
//         jti: randomUUID(),
//         typ: 'access',
//       } as JwtAccessPayload,
//       {
//         secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
//         expiresIn: this.accessTtlSeconds(),
//       },
//     );
//     const newRefreshToken = await this.jwt.signAsync(
//       {
//         sub: user.id,
//         orgId: user.orgId,
//         sid: session.id,
//         jti: randomUUID(),
//         typ: 'refresh',
//       } as JwtRefreshPayload,
//       {
//         secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
//         expiresIn: this.refreshTtlSeconds(),
//       },
//     );
//     const newHash = await bcrypt.hash(newRefreshToken, 12);
//     await this.sessions.update(
//       { id: session.id },
//       { refreshTokenHash: newHash, lastUsedAt: new Date(), userAgent, ip },
//     );
//     return { accessToken, refreshToken: newRefreshToken };
//   }

//   // ─── Logout ───────────────────────────────────────────────────────────────

//   async logout(params: { orgId: string; userId: string; sessionId?: string }) {
//     const { orgId, userId, sessionId } = params;
//     if (sessionId) {
//       await this.sessions.update(
//         { id: sessionId, orgId, userId },
//         { revokedAt: new Date() },
//       );
//       return;
//     }
//     await this.sessions.update(
//       { orgId, userId, revokedAt: null as any },
//       { revokedAt: new Date() },
//     );
//   }

//   // ─── Me ───────────────────────────────────────────────────────────────────

//   async me(ctx: { userId: string; orgId: string }) {
//     const user = await this.users.findOne({ where: { id: ctx.userId } as any });
//     if (!user) throw new NotFoundException('User not found');
//     return {
//       user: {
//         id: user.id,
//         email: user.email,
//         name: user.name,
//         role: user.role,
//         orgId: user.orgId,
//       },
//     };
//   }

//   // ─── Forgot Password — Email (magic link) ────────────────────────────────

//   async forgotPassword(email: string): Promise<void> {
//     const normalizedEmail = email.trim().toLowerCase();
//     const user = await this.users.findOne({
//       where: { email: normalizedEmail, isActive: true },
//     });
//     if (!user) {
//       this.logger.log(
//         `[Auth] Forgot password: email not found (${normalizedEmail}) — silent return`,
//       );
//       return;
//     }

//     const rawToken = randomBytes(32).toString('hex');
//     const tokenHash = createHash('sha256').update(rawToken).digest('hex');
//     const expiresAt = new Date(Date.now() + RESET_EXPIRES_MINUTES * 60 * 1000);
//     await this.users.update(
//       { id: user.id },
//       { resetPasswordToken: tokenHash, resetPasswordExpiresAt: expiresAt },
//     );

//     const frontendUrl =
//       this.config.get<string>('FRONTEND_URL') ?? 'https://commerceos.xenlo.app';
//     const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(normalizedEmail)}`;
//     const displayName = user.name ?? normalizedEmail.split('@')[0];

//     try {
//       await this.email.sendPasswordResetLink({
//         to: normalizedEmail,
//         name: displayName,
//         resetUrl,
//         expiresInMinutes: RESET_EXPIRES_MINUTES,
//       });
//     } catch (err) {
//       this.logger.error('[Auth] Failed to send reset email', err);
//     }

//     if (user.phone) {
//       try {
//         await this.sms.sendPasswordResetLink({
//           to: user.phone,
//           name: displayName,
//           resetUrl,
//           expiresInMinutes: RESET_EXPIRES_MINUTES,
//         });
//       } catch (err) {
//         this.logger.error('[Auth] Failed to send reset SMS', err);
//       }
//     }
//   }

//   // ─── Forgot Password — Phone (OTP) ───────────────────────────────────────
//   //
//   // Flow:
//   //   1. User submits phone number
//   //   2. We find user by phone within any org (phone should be unique per org)
//   //   3. Generate 4-digit OTP, store bcrypt hash + expiry
//   //   4. Send OTP via SMS
//   //   5. Frontend collects OTP → verifyOtp → reset password

//   async forgotPasswordByPhone(phone: string, email: string): Promise<void> {
//     const normalizedPhone = phone.trim();
//     const normalizedEmail = email.trim().toLowerCase();

//     // Find user by phone — search across all orgs (phone is unique per user)
//     const user = await this.users.findOne({
//       where: { phone: normalizedPhone, email: normalizedEmail, isActive: true },
//     });

//     // Always silent — don't reveal if phone exists
//     if (!user) {
//       this.logger.log(
//         `[Auth] OTP: phone not found (${normalizedPhone}) — silent return`,
//       );
//       return;
//     }

//     // Generate 4-digit OTP
//     const otp = Array.from({ length: OTP_LENGTH }, () =>
//       Math.floor(Math.random() * 10),
//     ).join('');
//     const otpHash = await bcrypt.hash(otp, 10); // lower cost — OTP is short-lived
//     const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);
//     // DEVELOPMENT ONLY — remove before production
//     if (process.env.NODE_ENV !== 'production') {
//       this.logger.log(`[Auth] DEV OTP for ${normalizedPhone}: ${otp}`);
//     }
//     await this.users.update(
//       { id: user.id },
//       { otpHash, otpExpiresAt: expiresAt },
//     );

//     const displayName = user.name ?? normalizedPhone;

//     try {
//       await this.sms.sendOtp({
//         to: normalizedPhone,
//         name: displayName,
//         otp,
//         expiresInMinutes: OTP_EXPIRES_MINUTES,
//       });
//     } catch (err) {
//       this.logger.error('[Auth] Failed to send OTP SMS', err);
//     }
//   }

//   // ─── Verify OTP ───────────────────────────────────────────────────────────

//   async verifyOtp(params: {
//     phone: string;
//     email: string;
//     otp: string;
//   }): Promise<{ valid: boolean; resetToken?: string }> {
//     const { phone, otp, email } = params;
//     const normalizedPhone = phone.trim();

//     const user = await this.users.findOne({
//       where: {
//         phone: normalizedPhone,
//         email: email.trim().toLowerCase(),
//         isActive: true,
//       },
//     });
//     if (!user || !user.otpHash || !user.otpExpiresAt) return { valid: false };
//     if (user.otpExpiresAt < new Date()) {
//       await this.users.update(
//         { id: user.id },
//         { otpHash: undefined, otpExpiresAt: undefined },
//       );
//       return { valid: false };
//     }

//     const match = await bcrypt.compare(otp, user.otpHash);
//     if (!match) return { valid: false };

//     // OTP verified — generate a short-lived reset token for the password step
//     // This avoids exposing the phone on the reset-password page URL
//     const rawToken = randomBytes(32).toString('hex');
//     const tokenHash = createHash('sha256').update(rawToken).digest('hex');
//     const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min to complete reset

//     await this.users.update(
//       { id: user.id },
//       {
//         resetPasswordToken: tokenHash,
//         resetPasswordExpiresAt: expiresAt,
//         otpHash: undefined, // clear OTP — can't be reused
//         otpExpiresAt: undefined,
//       },
//     );

//     return { valid: true, resetToken: rawToken };
//   }

//   // ─── Verify Reset Token (magic link) ─────────────────────────────────────

//   async verifyResetToken(params: {
//     email: string;
//     token: string;
//   }): Promise<{ valid: boolean }> {
//     const { email, token } = params;
//     const normalizedEmail = email.trim().toLowerCase();
//     const tokenHash = createHash('sha256').update(token).digest('hex');
//     const user = await this.users.findOne({
//       where: { email: normalizedEmail, resetPasswordToken: tokenHash },
//     });
//     if (
//       !user ||
//       !user.resetPasswordExpiresAt ||
//       user.resetPasswordExpiresAt < new Date()
//     )
//       return { valid: false };
//     return { valid: true };
//   }

//   // ─── Reset Password ───────────────────────────────────────────────────────
//   // Used by both email magic link and OTP flows — they both produce a resetToken

//   async resetPassword(params: {
//     email?: string;
//     phone?: string;
//     token: string;
//     newPassword: string;
//   }): Promise<void> {
//     const { token, newPassword } = params;
//     const tokenHash = createHash('sha256').update(token).digest('hex');

//     // Find by email or phone — whichever was provided
//     let user: UserEntity | null = null;
//     if (params.email) {
//       user = await this.users.findOne({
//         where: {
//           email: params.email.trim().toLowerCase(),
//           resetPasswordToken: tokenHash,
//         },
//       });
//     } else if (params.phone) {
//       user = await this.users.findOne({
//         where: { phone: params.phone.trim(), resetPasswordToken: tokenHash },
//       });
//     }

//     if (!user) throw new BadRequestException('Invalid or expired reset link');
//     if (
//       !user.resetPasswordExpiresAt ||
//       user.resetPasswordExpiresAt < new Date()
//     ) {
//       await this.users.update(
//         { id: user.id },
//         { resetPasswordToken: undefined, resetPasswordExpiresAt: undefined },
//       );
//       throw new BadRequestException(
//         'Reset link has expired. Please request a new one.',
//       );
//     }
//     if (newPassword.length < 8)
//       throw new BadRequestException('Password must be at least 8 characters');

//     const passwordHash = await bcrypt.hash(newPassword, 12);
//     await this.users.update(
//       { id: user.id },
//       {
//         passwordHash,
//         resetPasswordToken: undefined,
//         resetPasswordExpiresAt: undefined,
//       },
//     );
//     await this.sessions.update(
//       { orgId: user.orgId, userId: user.id, revokedAt: null as any },
//       { revokedAt: new Date() },
//     );
//     this.logger.log(`[Auth] Password reset successful for user ${user.id}`);
//   }
// }
