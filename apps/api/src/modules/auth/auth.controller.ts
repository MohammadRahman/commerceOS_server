/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// v1
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import express from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Ctx } from '@app/common/utils/request-context';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RegisterDto } from './dto/register.dto';

@Controller('v1/auth')
// @UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  // @Throttle(THROTTLE_AUTH)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }
  @Post('login')
  @HttpCode(200)
  // @Throttle(THROTTLE_AUTH)
  async login(@Body() dto: LoginDto, @Req() req: express.Request) {
    return this.auth.login({
      email: dto.email,
      password: dto.password,
      orgId: dto.orgId,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
  }
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Ctx() ctx: { userId: string; orgId: string }) {
    return this.auth.me({ userId: ctx.userId, orgId: ctx.orgId });
  }
  @Post('refresh')
  @HttpCode(200)
  // @Throttle({ refresh: { limit: 20, ttl: 60_000 } })
  async refresh(@Body() dto: RefreshDto, @Req() req: express.Request) {
    return this.auth.refresh({
      refreshToken: dto.refreshToken,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  // @SkipThrottle()
  @Post('logout')
  async logout(@Ctx() ctx: { orgId: string; userId: string }) {
    // for now: logout all sessions (simple)
    await this.auth.logout({ orgId: ctx.orgId, userId: ctx.userId });
    return { ok: true };
  }
}
