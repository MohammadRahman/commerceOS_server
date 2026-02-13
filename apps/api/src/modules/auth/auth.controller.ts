import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import express from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Ctx } from '@app/common/utils/request-context';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('v1/auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: express.Request) {
    return this.auth.login({
      email: dto.email,
      password: dto.password,
      orgId: dto.orgId,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshDto, @Req() req: express.Request) {
    return this.auth.refresh({
      refreshToken: dto.refreshToken,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Ctx() ctx: { orgId: string; userId: string }) {
    // for now: logout all sessions (simple)
    await this.auth.logout({ orgId: ctx.orgId, userId: ctx.userId });
    return { ok: true };
  }
}
