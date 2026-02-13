/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

import { UserEntity } from '../tenancy/entities/user.entity';
import { UserSessionEntity } from '../tenancy/entities/user-session.entity';
import { JwtAccessPayload, JwtRefreshPayload } from '@app/common/types/auth';

@Injectable()
export class AuthService {
  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    @InjectRepository(UserEntity) private users: Repository<UserEntity>,
    @InjectRepository(UserSessionEntity)
    private sessions: Repository<UserSessionEntity>,
  ) {}

  private accessTtlSeconds() {
    return Number(this.config.getOrThrow<string>('JWT_ACCESS_TTL_SECONDS'));
  }

  private refreshTtlSeconds() {
    return Number(this.config.getOrThrow<string>('JWT_REFRESH_TTL_SECONDS'));
  }

  async login(params: {
    email: string;
    password: string;
    orgId?: string;
    userAgent?: string;
    ip?: string;
  }) {
    const { email, password, orgId, userAgent, ip } = params;

    // ---------- Find user (multi-tenant safe) ----------
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

    // ---------- Generate session id FIRST ----------
    const sessionId = randomUUID();

    // ---------- Create JWT payloads ----------
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

    // ---------- Sign tokens ----------
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.accessTtlSeconds(),
    });

    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.refreshTtlSeconds(),
    });

    // ---------- Hash refresh token BEFORE inserting session ----------
    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);

    // ---------- Insert session row with hash already present ----------
    await this.sessions.save(
      this.sessions.create({
        id: sessionId,
        orgId: user.orgId,
        userId: user.id,
        refreshTokenHash,
        userAgent,
        ip,
        lastUsedAt: new Date(),
      }),
    );

    // ---------- Return tokens ----------
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

    // rotate refresh token (enterprise best practice)
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

    // logout all sessions
    await this.sessions.update(
      { orgId, userId, revokedAt: null as any },
      { revokedAt: new Date() },
    );
  }
}
