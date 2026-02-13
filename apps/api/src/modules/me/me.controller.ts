import { Controller, Get, UseGuards } from '@nestjs/common';
import { Ctx, RbacGuard, RequirePerm } from '@app/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/me')
@UseGuards(JwtAuthGuard, RbacGuard)
export class MeController {
  @UseGuards(JwtAuthGuard)
  @Get()
  @RequirePerm('inbox:read')
  me(@Ctx() ctx: { orgId: string; userId: string; role: string }) {
    // ctx is coming from JwtStrategy.validate()
    return { ok: true, ctx };
  }
}
