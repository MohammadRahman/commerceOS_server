/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/workers/notifications.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  QUEUE_NAMES,
  NOTIFICATION_JOBS,
} from '@app/common/queue/queue.constants';
import { EmailService } from 'apps/api/src/modules/notifications/services/email.service';
import { SmsService } from 'apps/api/src/modules/notifications/services/sms.service';
import { OrganizationEntity } from 'apps/api/src/modules/tenancy/entities/organization.entity';
import { UserEntity } from 'apps/api/src/modules/tenancy/entities/user.entity';

@Processor(QUEUE_NAMES.NOTIFICATIONS, { concurrency: 10 })
@Injectable()
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly email: EmailService,
    private readonly sms: SmsService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.debug(`[Notifications] Processing ${job.name} id=${job.id}`);

    switch (job.name) {
      case NOTIFICATION_JOBS.SEND_EMAIL:
        return this.handleSendEmail(job.data);
      case NOTIFICATION_JOBS.SEND_SMS:
        return this.handleSendSms(job.data);
      case NOTIFICATION_JOBS.TRIAL_EXPIRING:
        return this.handleTrialExpiring(job.data);
      case NOTIFICATION_JOBS.TRIAL_EXPIRED:
        return this.handleTrialExpired(job.data);
      case NOTIFICATION_JOBS.SUBSCRIPTION_ACTIVATED:
        return this.handleSubscriptionActivated(job.data);
      case NOTIFICATION_JOBS.SUBSCRIPTION_CANCELLED:
        return this.handleSubscriptionCancelled(job.data);
      case NOTIFICATION_JOBS.PAYMENT_RECEIVED:
        return this.handlePaymentReceived(job.data);
      case NOTIFICATION_JOBS.PAYMENT_FAILED:
        return this.handlePaymentFailed(job.data);
      case NOTIFICATION_JOBS.PAYMENT_PROOF_SUBMITTED:
        return this.handlePaymentProofSubmitted(job.data);
      default:
        this.logger.warn(`[Notifications] Unknown job: ${job.name}`);
    }
  }

  // ─── Raw sends (used by outbox bridge for generic email/SMS) ──────────────

  private async handleSendEmail(data: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }) {
    await this.email.send(data);
  }

  private async handleSendSms(data: { to: string; message: string }) {
    await this.sms.send(data.to, data.message);
  }

  // ─── Trial expiring ────────────────────────────────────────────────────────

  private async handleTrialExpiring(data: {
    orgId: string;
    daysLeft: number;
    trialEndsAt: string;
  }) {
    const owner = await this.getOrgOwner(data.orgId);
    if (!owner) return;

    const name = owner.name ?? owner.email.split('@')[0];
    const frontendUrl = 'https://app.xenlo.app';
    const endsDate = new Date(data.trialEndsAt).toDateString();
    const urgentColor = data.daysLeft <= 1 ? '#dc2626' : '#d97706';

    await this.email.send({
      to: owner.email,
      subject: `⏰ Your Xenlo trial expires in ${data.daysLeft} day${data.daysLeft === 1 ? '' : 's'}`,
      html: baseHtml({
        title: `Trial expires in ${data.daysLeft} days`,
        preheader: `Your free trial ends on ${endsDate}. Upgrade now to keep all features.`,
        body: `
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">⏰ Trial ending soon</p>
          <p style="margin:0 0 20px;font-size:15px;color:#71717a;line-height:1.6;">Hi ${name}, your Xenlo free trial ends in <strong style="color:${urgentColor}">${data.daysLeft} day${data.daysLeft === 1 ? '' : 's'}</strong> (${endsDate}).</p>
          <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:24px;">
            <p style="margin:0;font-size:13px;color:#92400e;">After your trial, you'll keep <strong>Inbox, Orders & Analytics</strong>. All other features will be locked until you upgrade.</p>
          </div>
          ${ctaButton(`${frontendUrl}/subscription`, 'Upgrade now', urgentColor)}
          <p style="margin:0;font-size:12px;color:#a1a1aa;">Questions? Reply to this email and we'll help.</p>`,
      }),
      text: `Hi ${name}, your Xenlo trial expires in ${data.daysLeft} day${data.daysLeft === 1 ? '' : 's'} (${endsDate}). Upgrade at ${frontendUrl}/subscription`,
    });

    if (owner.phone) {
      await this.sms
        .send(
          owner.phone,
          `Hi ${name}, your Xenlo trial expires in ${data.daysLeft} day${data.daysLeft === 1 ? '' : 's'}. Upgrade: ${frontendUrl}/subscription`,
        )
        .catch(() => undefined);
    }

    this.logger.log(`[Notifications] Trial warning sent → ${owner.email}`);
  }

  // ─── Trial expired ─────────────────────────────────────────────────────────

  private async handleTrialExpired(data: { orgId: string }) {
    const owner = await this.getOrgOwner(data.orgId);
    if (!owner) return;

    const name = owner.name ?? owner.email.split('@')[0];
    const frontendUrl = 'https://app.xenlo.app';

    await this.email.send({
      to: owner.email,
      subject: '🔒 Your Xenlo trial has ended — upgrade to restore access',
      html: baseHtml({
        title: 'Trial ended',
        preheader: 'Upgrade to restore full access to Xenlo.',
        body: `
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">🔒 Trial has ended</p>
          <p style="margin:0 0 20px;font-size:15px;color:#71717a;line-height:1.6;">Hi ${name}, your free trial has expired. <strong>Inbox and Orders</strong> remain accessible, but other features are locked.</p>
          <div style="background:#f4f4f5;border-radius:8px;padding:16px;margin-bottom:24px;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#18181b;">Unlock with Pro:</p>
            <ul style="margin:0;padding-left:16px;font-size:13px;color:#71717a;line-height:1.8;">
              <li>Storefront builder</li>
              <li>Live Sales (Facebook & Instagram)</li>
              <li>Marketing & AI replies</li>
              <li>Payment & courier setup</li>
            </ul>
          </div>
          ${ctaButton(`${frontendUrl}/subscription`, 'Upgrade to Pro', '#2563eb')}`,
      }),
      text: `Hi ${name}, your trial expired. Inbox and Orders are still available. Upgrade at ${frontendUrl}/subscription`,
    });

    this.logger.log(`[Notifications] Trial expired email → ${owner.email}`);
  }

  // ─── Subscription activated ────────────────────────────────────────────────

  private async handleSubscriptionActivated(data: {
    subscriptionId: string;
    orgId: string;
    plan: string;
    paymentId: string;
  }) {
    const owner = await this.getOrgOwner(data.orgId);
    if (!owner) return;

    const name = owner.name ?? owner.email.split('@')[0];
    const frontendUrl = 'https://app.xenlo.app';

    await this.email.send({
      to: owner.email,
      subject: `🎉 Welcome to Xenlo ${data.plan} — you're all set!`,
      html: baseHtml({
        title: `${data.plan} activated`,
        preheader: `Your ${data.plan} plan is active. All features are unlocked.`,
        body: `
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">🎉 You're on ${data.plan}!</p>
          <p style="margin:0 0 20px;font-size:15px;color:#71717a;line-height:1.6;">Hi ${name}, your <strong>Xenlo ${data.plan}</strong> subscription is now active. All features are unlocked.</p>
          ${ctaButton(`${frontendUrl}`, 'Go to dashboard', '#16a34a')}
          <p style="margin:0;font-size:12px;color:#a1a1aa;">Manage your subscription at <a href="${frontendUrl}/subscription" style="color:#71717a;">${frontendUrl}/subscription</a></p>`,
      }),
      text: `Hi ${name}, your Xenlo ${data.plan} plan is active! Go to ${frontendUrl}`,
    });

    if (owner.phone) {
      await this.sms
        .send(
          owner.phone,
          `Hi ${name}! Your Xenlo ${data.plan} plan is now active 🎉`,
        )
        .catch(() => undefined);
    }

    this.logger.log(
      `[Notifications] Activation email → ${owner.email} (${data.plan})`,
    );
  }

  // ─── Subscription cancelled ────────────────────────────────────────────────

  private async handleSubscriptionCancelled(data: {
    subscriptionId: string;
    orgId: string;
    immediately: boolean;
  }) {
    const owner = await this.getOrgOwner(data.orgId);
    if (!owner) return;

    const name = owner.name ?? owner.email.split('@')[0];
    const frontendUrl = 'https://app.xenlo.app';

    await this.email.send({
      to: owner.email,
      subject: 'Your Xenlo subscription has been cancelled',
      html: baseHtml({
        title: 'Subscription cancelled',
        preheader: data.immediately
          ? 'Your subscription has been cancelled.'
          : 'Your subscription will cancel at period end.',
        body: `
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">Subscription cancelled</p>
          <p style="margin:0 0 20px;font-size:15px;color:#71717a;line-height:1.6;">Hi ${name}, ${
            data.immediately
              ? 'your subscription has been cancelled immediately. Your account is now on the free plan.'
              : 'your subscription will remain active until the end of your current billing period. After that, your account moves to the free plan.'
          }</p>
          ${ctaButton(`${frontendUrl}/subscription`, 'Resubscribe any time')}
          <p style="margin:0;font-size:13px;color:#71717a;">Sorry to see you go — if there's anything we could do better, please reply to this email.</p>`,
      }),
      text: `Hi ${name}, your Xenlo subscription has been cancelled. You can resubscribe at ${frontendUrl}/subscription`,
    });

    this.logger.log(`[Notifications] Cancellation email → ${owner.email}`);
  }

  // ─── Payment received ──────────────────────────────────────────────────────

  private async handlePaymentReceived(data: {
    orgId: string;
    paymentId: string;
    amount: number;
    provider: string;
  }) {
    const owner = await this.getOrgOwner(data.orgId);
    if (!owner) return;

    const name = owner.name ?? owner.email.split('@')[0];
    const frontendUrl = 'https://app.xenlo.app';
    const receiptId = data.paymentId.slice(0, 8).toUpperCase();

    await this.email.send({
      to: owner.email,
      subject: `✅ Payment confirmed — ৳${data.amount.toLocaleString()} received`,
      html: baseHtml({
        title: 'Payment confirmed',
        preheader: `৳${data.amount.toLocaleString()} received via ${data.provider}. Receipt: ${receiptId}`,
        body: `
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">✅ Payment confirmed</p>
          <p style="margin:0 0 20px;font-size:15px;color:#71717a;line-height:1.6;">Hi ${name}, we've received your payment. Your subscription is active.</p>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:24px;">
            <table width="100%" cellpadding="4" cellspacing="0">
              <tr><td style="font-size:13px;color:#71717a;">Amount</td><td style="font-size:13px;font-weight:700;color:#18181b;text-align:right;">৳${data.amount.toLocaleString()}</td></tr>
              <tr><td style="font-size:13px;color:#71717a;">Via</td><td style="font-size:13px;color:#18181b;text-align:right;text-transform:capitalize;">${data.provider}</td></tr>
              <tr><td style="font-size:13px;color:#71717a;">Receipt ID</td><td style="font-size:13px;font-family:monospace;color:#18181b;text-align:right;">${receiptId}</td></tr>
            </table>
          </div>
          ${ctaButton(`${frontendUrl}`, 'Go to dashboard', '#16a34a')}`,
      }),
      text: `Hi ${name}, payment of ৳${data.amount.toLocaleString()} confirmed via ${data.provider}. Receipt: ${receiptId}`,
    });

    this.logger.log(
      `[Notifications] Receipt sent → ${owner.email} ৳${data.amount}`,
    );
  }

  // ─── Payment failed ────────────────────────────────────────────────────────

  private async handlePaymentFailed(data: {
    orgId: string;
    subscriptionId: string;
    reason: string;
  }) {
    const owner = await this.getOrgOwner(data.orgId);
    if (!owner) return;

    const name = owner.name ?? owner.email.split('@')[0];
    const frontendUrl = 'https://app.xenlo.app';

    await this.email.send({
      to: owner.email,
      subject: '⚠️ Payment failed — action required',
      html: baseHtml({
        title: 'Payment failed',
        preheader: 'Your Xenlo payment failed. Please retry.',
        body: `
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">⚠️ Payment failed</p>
          <p style="margin:0 0 20px;font-size:15px;color:#71717a;line-height:1.6;">Hi ${name}, your payment could not be processed.</p>
          ${data.reason ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:20px;font-size:13px;color:#dc2626;">${data.reason}</div>` : ''}
          ${ctaButton(`${frontendUrl}/subscription`, 'Retry payment', '#dc2626')}
          <p style="margin:0;font-size:13px;color:#71717a;">If you keep having trouble, reply to this email and we'll sort it out.</p>`,
      }),
      text: `Hi ${name}, your Xenlo payment failed (${data.reason}). Retry at ${frontendUrl}/subscription`,
    });

    if (owner.phone) {
      await this.sms
        .send(
          owner.phone,
          `Hi ${name}, your Xenlo payment failed. Please retry: ${frontendUrl}/subscription`,
        )
        .catch(() => undefined);
    }

    this.logger.log(`[Notifications] Payment failed email → ${owner.email}`);
  }

  // ─── Payment proof submitted ───────────────────────────────────────────────
  // 1. Alert all platform admins so they can confirm in the admin portal
  // 2. Acknowledge receipt to the org owner

  private async handlePaymentProofSubmitted(data: {
    orgId: string;
    subscriptionPaymentId: string;
    trxId?: string;
    screenshotUrl?: string;
  }) {
    const [owner, org, admins] = await Promise.all([
      this.getOrgOwner(data.orgId),
      this.orgs.findOne({ where: { id: data.orgId } as any }),
      this.getPlatformAdmins(),
    ]);

    const orgName = org?.name ?? data.orgId;
    const frontendUrl = 'https://app.xenlo.app';
    const receiptId = data.subscriptionPaymentId.slice(0, 8).toUpperCase();

    // Notify each platform admin
    for (const admin of admins) {
      const adminName = admin.name ?? admin.email.split('@')[0];
      await this.email
        .send({
          to: admin.email,
          subject: `💳 Manual payment proof — ${orgName} (${receiptId})`,
          html: baseHtml({
            title: `Payment proof — ${orgName}`,
            preheader: `${orgName} submitted a payment proof. Confirmation required.`,
            body: `
            <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">💳 Payment proof submitted</p>
            <p style="margin:0 0 20px;font-size:15px;color:#71717a;line-height:1.6;">Hi ${adminName}, <strong>${orgName}</strong> has submitted a manual payment that requires your confirmation.</p>
            <div style="background:#f4f4f5;border-radius:8px;padding:16px;margin-bottom:24px;">
              <table width="100%" cellpadding="4" cellspacing="0">
                <tr><td style="font-size:13px;color:#71717a;">Org</td><td style="font-size:13px;font-weight:600;color:#18181b;">${orgName}</td></tr>
                <tr><td style="font-size:13px;color:#71717a;">Payment ID</td><td style="font-size:13px;font-family:monospace;color:#18181b;">${receiptId}</td></tr>
                ${data.trxId ? `<tr><td style="font-size:13px;color:#71717a;">Tx ID</td><td style="font-size:13px;font-family:monospace;color:#18181b;">${data.trxId}</td></tr>` : ''}
                ${data.screenshotUrl ? `<tr><td style="font-size:13px;color:#71717a;">Screenshot</td><td style="font-size:13px;"><a href="${data.screenshotUrl}" style="color:#2563eb;">View screenshot</a></td></tr>` : ''}
              </table>
            </div>
            ${ctaButton(`${frontendUrl}/admin`, 'Confirm in Admin Portal', '#2563eb')}`,
          }),
          text: `${orgName} submitted payment proof. TxID: ${data.trxId ?? 'N/A'}. Confirm at ${frontendUrl}/admin`,
        })
        .catch(() => undefined); // Non-fatal if one admin email fails
    }

    // Acknowledge to org owner
    if (owner) {
      const name = owner.name ?? owner.email.split('@')[0];
      await this.email.send({
        to: owner.email,
        subject: "📨 Payment proof received — we'll confirm shortly",
        html: baseHtml({
          title: 'Proof received',
          preheader:
            'We received your payment proof and will confirm within a few hours.',
          body: `
            <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">📨 Proof received</p>
            <p style="margin:0 0 20px;font-size:15px;color:#71717a;line-height:1.6;">Hi ${name}, we've received your payment proof${data.trxId ? ` (TxID: <strong>${data.trxId}</strong>)` : ''}. Our team will verify and activate your plan within a few hours.</p>
            <p style="margin:0;font-size:13px;color:#71717a;">You'll receive another email once your subscription is active. Reply here if you have questions.</p>`,
        }),
        text: `Hi ${name}, we received your payment proof${data.trxId ? ` (TxID: ${data.trxId})` : ''}. We'll confirm within a few hours.`,
      });
    }

    this.logger.log(
      `[Notifications] Proof alerts sent — org ${data.orgId}, ${admins.length} admin(s) notified`,
    );
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async getOrgOwner(orgId: string): Promise<UserEntity | null> {
    const owner = await this.users.findOne({
      where: { orgId, role: 'OWNER' as any, isActive: true } as any,
    });
    if (!owner) {
      this.logger.warn(`[Notifications] No owner for org ${orgId}`);
    }
    return owner ?? null;
  }

  private async getPlatformAdmins(): Promise<UserEntity[]> {
    return this.users.find({
      where: { isPlatformAdmin: true, isActive: true } as any,
    });
  }
}

// ─── Shared template helpers ───────────────────────────────────────────────────

function baseHtml(p: {
  title: string;
  preheader: string;
  body: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${p.title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">${p.preheader}</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr><td style="background:#18181b;padding:24px 32px;">
          <span style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.5px;">Xenlo</span>
        </td></tr>
        <tr><td style="padding:32px;">${p.body}</td></tr>
        <tr><td style="padding:16px 32px;background:#fafafa;border-top:1px solid #e4e4e7;">
          <p style="margin:0;font-size:11px;color:#a1a1aa;">© ${new Date().getFullYear()} Xenlo · xenlo.app</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function ctaButton(url: string, label: string, color = '#18181b'): string {
  return `<table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr><td style="background:${color};border-radius:8px;padding:12px 28px;">
      <a href="${url}" target="_blank" style="color:#fff;font-size:14px;font-weight:600;text-decoration:none;">${label} →</a>
    </td></tr>
  </table>`;
}
