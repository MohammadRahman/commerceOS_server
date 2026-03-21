import { IdempotencyModule, DatabaseModule } from '@app/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { ChannelEntity } from '../../modules/inbox/entities/channel.entity';
import { ConversationEntity } from '../../modules/inbox/entities/conversation.entity';
import { MessageEntity } from '../../modules/inbox/entities/message.entity';
import { MetaController } from './controllers/meta.controller';
import { MetaOAuthController } from './controllers/meta.oauth.controller';
import { MetaOAuthService } from './services/meta.oauth.service';
import { MetaService } from './services/meta.service';
import { Module } from '@nestjs/common';
import { InboxController } from './controllers/inbox.controller';
import { InboxService } from './services/inbox.service';
import { InboxGateway } from './gateway/inbox.gateway';
import { JwtModule } from '@nestjs/jwt';
import { CustomerIdentityEntity } from '../../modules/inbox/entities/customer-identity.entity';
import { CustomerEntity } from '../../modules/inbox/entities/customer.entity';
import { AutoMessageService } from './services/auto-message.service';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    JwtModule,
    IdempotencyModule,
    DatabaseModule.forFeature([
      ChannelEntity,
      ConversationEntity,
      MessageEntity,
      CustomerEntity,
      CustomerIdentityEntity,
    ]),
  ],
  controllers: [MetaController, MetaOAuthController, InboxController],
  providers: [
    MetaService,
    MetaOAuthService,
    InboxService,
    InboxGateway,
    AutoMessageService,
  ],
  exports: [InboxGateway, InboxService, AutoMessageService],
})
export class MetaModule {}
