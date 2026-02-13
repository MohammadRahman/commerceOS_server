import { Module } from '@nestjs/common';
import { InboxService } from './inbox.service';
import { InboxController } from './inbox.controller';
import { DatabaseModule } from '@app/common';
import { ChannelEntity } from './entities/channel.entity';
import { ConversationEntity } from './entities/conversation.entity';
import { CustomerIdentityEntity } from './entities/customer-identity.entity';
import { CustomerEntity } from './entities/customer.entity';
import { MessageEntity } from './entities/message.entity';

@Module({
  imports: [
    DatabaseModule.forFeature([
      ChannelEntity,
      ConversationEntity,
      MessageEntity,
      CustomerEntity,
      CustomerIdentityEntity,
    ]),
  ],
  controllers: [InboxController],
  providers: [InboxService],
})
export class InboxModule {}
