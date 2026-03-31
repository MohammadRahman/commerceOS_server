import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@app/common/database/database.module';

import { OrganizationEntity } from '../tenancy/entities/organization.entity';
import { UserEntity } from '../tenancy/entities/user.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { ChannelEntity } from '../inbox/entities/channel.entity';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule.forFeature([
      OrganizationEntity,
      UserEntity,
      OrderEntity,
      ChannelEntity,
    ]),
    JwtModule.register({}),
  ],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, PlatformAdminGuard],
})
export class PlatformAdminModule {}
