import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule, IdempotencyModule } from '@app/common';
import { ChannelEntity } from '../../modules/inbox/entities/channel.entity';
import { ConversationEntity } from '../../modules/inbox/entities/conversation.entity';
import { MessageEntity } from '../../modules/inbox/entities/message.entity';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { InboxModule } from '../../modules/inbox/inbox.module';
import { MetaModule } from '../meta/meta.module';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    IdempotencyModule,
    InboxModule,
    MetaModule,
    DatabaseModule,
    DatabaseModule.forFeature([
      ChannelEntity,
      ConversationEntity,
      MessageEntity,
    ]),
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService],
})
export class WhatsappModule {}
