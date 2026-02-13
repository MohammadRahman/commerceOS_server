import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtAccessPayload } from '@app/common/types/auth';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
    });
  }

  validate(payload: JwtAccessPayload) {
    if (!payload?.sub || !payload?.orgId) throw new UnauthorizedException();

    // This becomes req.user
    return {
      userId: payload.sub,
      orgId: payload.orgId,
      role: payload.role,
    };
  }
}
