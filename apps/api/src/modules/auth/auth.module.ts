import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from '@app/common/database/database.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

import { UserEntity } from '../tenancy/entities/user.entity';
import { UserSessionEntity } from '../tenancy/entities/user-session.entity';
import { JwtStrategy } from './strategy/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule.forFeature([UserEntity, UserSessionEntity]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (_config: ConfigService) => ({}), // we pass secrets per-sign to keep access/refresh split clean
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
