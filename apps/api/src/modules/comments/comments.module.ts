// apps/api/src/modules/comments/comments.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PostEntity } from './entities/post.entity';
import { PostCommentEntity } from './entities/post-comment.entity';
import { AutoReplyRuleEntity } from './entities/auto-reply-rule.entity';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { AiModule } from '../ai/ai.module';
import { ChannelEntity } from '../inbox/entities/channel.entity';

@Module({
  imports: [
    ConfigModule,
    AiModule,
    TypeOrmModule.forFeature([
      PostEntity,
      PostCommentEntity,
      AutoReplyRuleEntity,
      ChannelEntity,
    ]),
  ],
  providers: [CommentsService],
  controllers: [CommentsController],
  exports: [CommentsService], // exported so MetaWebhookHandler can call ingestWebhookComment
})
export class CommentsModule {}
