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

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    IdempotencyModule,
    DatabaseModule.forFeature([
      ChannelEntity,
      ConversationEntity,
      MessageEntity,
    ]),
  ],
  controllers: [MetaController, MetaOAuthController],
  providers: [MetaService, MetaOAuthService],
})
export class MetaModule {}
