/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/modules/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { EmailService } from './services/email.service';
import { SmsService } from './services/sms.service';
import { BullModule } from '@nestjs/bull';
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'notifications', // ✅ MUST match exactly
    }),
  ],
  providers: [EmailService, SmsService],
  exports: [EmailService, SmsService],
})
export class NotificationsModule {}
