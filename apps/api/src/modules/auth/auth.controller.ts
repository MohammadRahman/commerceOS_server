// v2 with reset password flow and transactional email templates
// apps/api/src/modules/auth/auth.controller.ts
// v2 — adds /forgot-password, /reset-password, /verify-reset-token
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
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
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Ctx } from '@app/common/utils/request-context';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RegisterDto } from './dto/register.dto';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

class VerifyResetTokenDto {
  @IsEmail()
  email!: string;

  @IsString()
  token!: string;
}

class ResetPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

// ─── Controller ───────────────────────────────────────────────────────────────

@Controller('v1/auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
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
  async refresh(@Body() dto: RefreshDto, @Req() req: express.Request) {
    return this.auth.refresh({
      refreshToken: dto.refreshToken,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('logout')
  async logout(@Ctx() ctx: { orgId: string; userId: string }) {
    await this.auth.logout({ orgId: ctx.orgId, userId: ctx.userId });
    return { ok: true };
  }

  // ── Password reset flow ───────────────────────────────────────────────────

  /**
   * POST /v1/auth/forgot-password
   * Always returns 200 — never reveals if email exists.
   * Sends magic link via email + SMS.
   */
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return {
      message:
        'If an account exists with that email, a reset link has been sent.',
    };
  }

  /**
   * POST /v1/auth/verify-reset-token
   * Called when user lands on /reset-password page.
   * Returns { valid: true/false } — frontend shows form or error.
   */
  @Post('verify-reset-token')
  @HttpCode(200)
  async verifyResetToken(@Body() dto: VerifyResetTokenDto) {
    return this.auth.verifyResetToken({ email: dto.email, token: dto.token });
  }

  /**
   * POST /v1/auth/reset-password
   * Validates token, updates password, revokes all sessions.
   */
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword({
      email: dto.email,
      token: dto.token,
      newPassword: dto.newPassword,
    });
    return {
      message:
        'Password reset successfully. Please log in with your new password.',
    };
  }
}
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// // v1
// import {
//   Body,
//   Controller,
//   Get,
//   HttpCode,
//   Post,
//   Req,
//   UseGuards,
// } from '@nestjs/common';
// import express from 'express';
// import { AuthService } from './auth.service';
// import { LoginDto } from './dto/login.dto';
// import { RefreshDto } from './dto/refresh.dto';
// import { Ctx } from '@app/common/utils/request-context';
// import { JwtAuthGuard } from './guards/jwt-auth.guard';
// import { RegisterDto } from './dto/register.dto';

// @Controller('v1/auth')
// // @UseGuards(ThrottlerGuard)
// export class AuthController {
//   constructor(private auth: AuthService) {}

//   @Post('register')
//   // @Throttle(THROTTLE_AUTH)
//   register(@Body() dto: RegisterDto) {
//     return this.auth.register(dto);
//   }
//   @Post('login')
//   @HttpCode(200)
//   // @Throttle(THROTTLE_AUTH)
//   async login(@Body() dto: LoginDto, @Req() req: express.Request) {
//     return this.auth.login({
//       email: dto.email,
//       password: dto.password,
//       orgId: dto.orgId,
//       userAgent: req.headers['user-agent'],
//       ip: req.ip,
//     });
//   }
//   @Get('me')
//   @UseGuards(JwtAuthGuard)
//   async me(@Ctx() ctx: { userId: string; orgId: string }) {
//     return this.auth.me({ userId: ctx.userId, orgId: ctx.orgId });
//   }
//   @Post('refresh')
//   @HttpCode(200)
//   // @Throttle({ refresh: { limit: 20, ttl: 60_000 } })
//   async refresh(@Body() dto: RefreshDto, @Req() req: express.Request) {
//     return this.auth.refresh({
//       refreshToken: dto.refreshToken,
//       userAgent: req.headers['user-agent'],
//       ip: req.ip,
//     });
//   }

//   @UseGuards(JwtAuthGuard)
//   @HttpCode(200)
//   // @SkipThrottle()
//   @Post('logout')
//   async logout(@Ctx() ctx: { orgId: string; userId: string }) {
//     // for now: logout all sessions (simple)
//     await this.auth.logout({ orgId: ctx.orgId, userId: ctx.userId });
//     return { ok: true };
//   }
// }
