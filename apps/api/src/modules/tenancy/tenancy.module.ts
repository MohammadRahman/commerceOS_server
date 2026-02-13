import { DatabaseModule } from '@app/common';
import { Module } from '@nestjs/common';
import { OrganizationEntity } from './entities/organization.entity';
import { UserEntity } from './entities/user.entity';
import { UserSessionEntity } from './entities/user-session.entity';

@Module({
  imports: [
    DatabaseModule.forFeature([
      OrganizationEntity,
      UserEntity,
      UserSessionEntity,
    ]),
  ],
})
export class TenancyModule {}
