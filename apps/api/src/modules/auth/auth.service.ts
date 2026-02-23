/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Repository, DeepPartial } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

import { UserEntity, UserRole } from '../tenancy/entities/user.entity';
import { UserSessionEntity } from '../tenancy/entities/user-session.entity';
import { OrganizationEntity } from '../tenancy/entities/organization.entity';
import { JwtAccessPayload, JwtRefreshPayload } from '@app/common/types/auth';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger();
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
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

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.users.findOne({ where: { email } });
    if (existing) throw new BadRequestException('Email already registered');

    // Create org (force SINGLE entity overload)
    const orgCreate: DeepPartial<OrganizationEntity> = {
      name: dto.businessName,
      plan: 'FREE',
    };
    const org = await this.orgRepo.save(this.orgRepo.create(orgCreate));
    // Create user (force SINGLE entity overload)
    const passwordHash = await bcrypt.hash(dto.password, 12);

    const userCreate: DeepPartial<UserEntity> = {
      orgId: org.id,
      email,
      passwordHash,
      role: UserRole.OWNER,
      isActive: true,
    };
    const user = await this.users.save(this.users.create(userCreate));
    console.log('user', user);
    // Session + tokens
    const sessionId = randomUUID();

    const accessPayload: JwtAccessPayload = {
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      jti: randomUUID(),
      typ: 'access',
    };

    const refreshPayload: JwtRefreshPayload = {
      sub: user.id,
      orgId: user.orgId,
      sid: sessionId,
      jti: randomUUID(),
      typ: 'refresh',
    };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.accessTtlSeconds(),
    });

    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.refreshTtlSeconds(),
    });

    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);

    const sessionCreate: DeepPartial<UserSessionEntity> = {
      id: sessionId,
      orgId: user.orgId,
      userId: user.id,
      refreshTokenHash,
      userAgent: undefined,
      ip: undefined,
      lastUsedAt: new Date(),
    };

    await this.sessions.save(this.sessions.create(sessionCreate));

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        orgId: user.orgId,
        email: user.email,
        role: user.role,
      },
      organization: {
        id: org.id,
        name: org.name,
        plan: org.plan,
      },
      received: {
        ownerName: dto.ownerName,
        phone: dto.phone,
        mainChannel: dto.mainChannel ?? null,
      },
    };
  }

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

      if (matches.length > 1) {
        throw new BadRequestException(
          'Multiple organizations found for this email. Provide orgId.',
        );
      }

      user = matches[0];
    }

    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const sessionId = randomUUID();

    const accessPayload: JwtAccessPayload = {
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      jti: randomUUID(),
      typ: 'access',
    };

    const refreshPayload: JwtRefreshPayload = {
      sub: user.id,
      orgId: user.orgId,
      sid: sessionId,
      jti: randomUUID(),
      typ: 'refresh',
    };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.accessTtlSeconds(),
    });

    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.refreshTtlSeconds(),
    });

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
      },
    };
  }

  async refresh(params: {
    refreshToken: string;
    userAgent?: string;
    ip?: string;
  }) {
    const { refreshToken, userAgent, ip } = params;

    let payload: JwtRefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtRefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
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

    const newAccessPayload: JwtAccessPayload = {
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      jti: randomUUID(),
      typ: 'access',
    };

    const newRefreshPayload: JwtRefreshPayload = {
      sub: user.id,
      orgId: user.orgId,
      sid: session.id,
      jti: randomUUID(),
      typ: 'refresh',
    };

    const accessToken = await this.jwt.signAsync(newAccessPayload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.accessTtlSeconds(),
    });

    const newRefreshToken = await this.jwt.signAsync(newRefreshPayload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.refreshTtlSeconds(),
    });

    const newHash = await bcrypt.hash(newRefreshToken, 12);
    await this.sessions.update(
      { id: session.id },
      { refreshTokenHash: newHash, lastUsedAt: new Date(), userAgent, ip },
    );

    return { accessToken, refreshToken: newRefreshToken };
  }

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
}

/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// import {
//   Injectable,
//   UnauthorizedException,
//   BadRequestException,
// } from '@nestjs/common';
// import { JwtService } from '@nestjs/jwt';
// import { ConfigService } from '@nestjs/config';
// import { Repository } from 'typeorm';
// import { InjectRepository } from '@nestjs/typeorm';
// import * as bcrypt from 'bcrypt';
// import { randomUUID } from 'crypto';

// import { UserEntity, UserRole } from '../tenancy/entities/user.entity';
// import { UserSessionEntity } from '../tenancy/entities/user-session.entity';
// import { JwtAccessPayload, JwtRefreshPayload } from '@app/common/types/auth';
// import { OrganizationEntity } from '../tenancy/entities/organization.entity';
// import { RegisterDto } from './dto/register.dto';
// @Injectable()
// export class AuthService {
//   constructor(
//     private jwt: JwtService,
//     private config: ConfigService,
//     @InjectRepository(UserEntity) private users: Repository<UserEntity>,
//     @InjectRepository(UserSessionEntity)
//     private sessions: Repository<UserSessionEntity>,
//     @InjectRepository(OrganizationEntity)
//     private readonly orgRepo: Repository<OrganizationEntity>,
//   ) {}

//   private accessTtlSeconds() {
//     return Number(this.config.getOrThrow<string>('JWT_ACCESS_TTL_SECONDS'));
//   }

//   private refreshTtlSeconds() {
//     return Number(this.config.getOrThrow<string>('JWT_REFRESH_TTL_SECONDS'));
//   }

//   async register(dto: RegisterDto) {
//     const email = dto.email.trim().toLowerCase();

//     // 1) Prevent duplicate email (global). If you want per-org later, change this.
//     const existing = await this.users.findOne({ where: { email } as any });
//     if (existing) throw new BadRequestException('Email already registered');

//     // 2) Create org (matches OrganizationEntity fields)
//     const org = await this.orgRepo.save(
//       this.orgRepo.create({
//         name: dto.businessName,
//         plan: 'FREE',
//       } as any),
//     );

//     // 3) Create user (matches UserEntity fields)
//     const passwordHash = await bcrypt.hash(dto.password, 12);

//     const user = await this.users.save(
//       this.users.create({
//         orgId: org.id,
//         email,
//         passwordHash,
//         role: UserRole.OWNER,
//         isActive: true,
//       } as any),
//     );

//     // 4) Create session + tokens (same pattern as login)
//     const sessionId = randomUUID();

//     const accessPayload: JwtAccessPayload = {
//       sub: user.id,
//       orgId: user.orgId,
//       role: user.role,
//       jti: randomUUID(),
//       typ: 'access',
//     };

//     const refreshPayload: JwtRefreshPayload = {
//       sub: user.id,
//       orgId: user.orgId,
//       sid: sessionId,
//       jti: randomUUID(),
//       typ: 'refresh',
//     };

//     const accessToken = await this.jwt.signAsync(accessPayload, {
//       secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
//       expiresIn: this.accessTtlSeconds(),
//     });

//     const refreshToken = await this.jwt.signAsync(refreshPayload, {
//       secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
//       expiresIn: this.refreshTtlSeconds(),
//     });

//     const refreshTokenHash = await bcrypt.hash(refreshToken, 12);

//     await this.sessions.save(
//       this.sessions.create({
//         id: sessionId,
//         orgId: user.orgId,
//         userId: user.id,
//         refreshTokenHash,
//         userAgent: undefined,
//         ip: undefined,
//         lastUsedAt: new Date(),
//       } as any),
//     );

//     // 5) Response: keep it consistent with login()
//     return {
//       accessToken,
//       refreshToken,
//       user: {
//         id: user.id,
//         orgId: user.orgId,
//         email: user.email,
//         role: user.role,
//       },
//       organization: {
//         id: org.id,
//         name: org.name,
//         plan: org.plan,
//       },
//       // accepted from UI but not stored yet (until you add columns)
//       received: {
//         ownerName: dto.ownerName,
//         phone: dto.phone,
//         mainChannel: dto.mainChannel ?? null,
//       },
//     };
//   }

//   async login(params: {
//     email: string;
//     password: string;
//     orgId?: string;
//     userAgent?: string;
//     ip?: string;
//   }) {
//     const { email, password, orgId, userAgent, ip } = params;

//     // ---------- Find user (multi-tenant safe) ----------
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

//       if (matches.length > 1) {
//         throw new BadRequestException(
//           'Multiple organizations found for this email. Provide orgId.',
//         );
//       }

//       user = matches[0];
//     }

//     if (!user) throw new UnauthorizedException('Invalid credentials');

//     const ok = await bcrypt.compare(password, user.passwordHash);
//     if (!ok) throw new UnauthorizedException('Invalid credentials');

//     // ---------- Generate session id FIRST ----------
//     const sessionId = randomUUID();

//     // ---------- Create JWT payloads ----------
//     const accessPayload: JwtAccessPayload = {
//       sub: user.id,
//       orgId: user.orgId,
//       role: user.role,
//       jti: randomUUID(),
//       typ: 'access',
//     };

//     const refreshPayload: JwtRefreshPayload = {
//       sub: user.id,
//       orgId: user.orgId,
//       sid: sessionId,
//       jti: randomUUID(),
//       typ: 'refresh',
//     };

//     // ---------- Sign tokens ----------
//     const accessToken = await this.jwt.signAsync(accessPayload, {
//       secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
//       expiresIn: this.accessTtlSeconds(),
//     });

//     const refreshToken = await this.jwt.signAsync(refreshPayload, {
//       secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
//       expiresIn: this.refreshTtlSeconds(),
//     });

//     // ---------- Hash refresh token BEFORE inserting session ----------
//     const refreshTokenHash = await bcrypt.hash(refreshToken, 12);

//     // ---------- Insert session row with hash already present ----------
//     await this.sessions.save(
//       this.sessions.create({
//         id: sessionId,
//         orgId: user.orgId,
//         userId: user.id,
//         refreshTokenHash,
//         userAgent,
//         ip,
//         lastUsedAt: new Date(),
//       }),
//     );

//     // ---------- Return tokens ----------
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

//   async refresh(params: {
//     refreshToken: string;
//     userAgent?: string;
//     ip?: string;
//   }) {
//     const { refreshToken, userAgent, ip } = params;

//     let payload: JwtRefreshPayload;
//     try {
//       payload = await this.jwt.verifyAsync<JwtRefreshPayload>(refreshToken, {
//         secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
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

//     // rotate refresh token (enterprise best practice)
//     const user = await this.users.findOne({
//       where: { id: payload.sub, orgId: payload.orgId, isActive: true },
//     });
//     if (!user) throw new UnauthorizedException('User disabled');

//     const newAccessPayload: JwtAccessPayload = {
//       sub: user.id,
//       orgId: user.orgId,
//       role: user.role,
//       jti: randomUUID(),
//       typ: 'access',
//     };

//     const newRefreshPayload: JwtRefreshPayload = {
//       sub: user.id,
//       orgId: user.orgId,
//       sid: session.id,
//       jti: randomUUID(),
//       typ: 'refresh',
//     };

//     const accessToken = await this.jwt.signAsync(newAccessPayload, {
//       secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
//       expiresIn: this.accessTtlSeconds(),
//     });

//     const newRefreshToken = await this.jwt.signAsync(newRefreshPayload, {
//       secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
//       expiresIn: this.refreshTtlSeconds(),
//     });

//     const newHash = await bcrypt.hash(newRefreshToken, 12);
//     await this.sessions.update(
//       { id: session.id },
//       { refreshTokenHash: newHash, lastUsedAt: new Date(), userAgent, ip },
//     );

//     return { accessToken, refreshToken: newRefreshToken };
//   }

//   async logout(params: { orgId: string; userId: string; sessionId?: string }) {
//     const { orgId, userId, sessionId } = params;

//     if (sessionId) {
//       await this.sessions.update(
//         { id: sessionId, orgId, userId },
//         { revokedAt: new Date() },
//       );
//       return;
//     }

//     // logout all sessions
//     await this.sessions.update(
//       { orgId, userId, revokedAt: null as any },
//       { revokedAt: new Date() },
//     );
//   }
// }
