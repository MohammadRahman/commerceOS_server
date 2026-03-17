// apps/api/src/modules/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { EmailService } from './services/email.service';
import { SmsService } from './services/sms.service';

@Module({
  providers: [EmailService, SmsService],
  exports: [EmailService, SmsService],
})
export class NotificationsModule {}
