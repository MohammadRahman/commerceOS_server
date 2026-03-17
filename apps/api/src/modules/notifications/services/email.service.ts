// apps/api/src/modules/notifications/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.getOrThrow<string>('RESEND_API_KEY'));
    // e.g. "Nexlo <noreply@xenlo.app>"
    this.from =
      this.config.get<string>('EMAIL_FROM') ?? 'Nexlo <noreply@xenlo.app>';
  }

  async send(options: SendEmailOptions): Promise<void> {
    try {
      const { error } = await this.resend.emails.send({
        from: this.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      if (error) {
        this.logger.error(
          `[Email] Failed to send to ${options.to}: ${error.message}`,
        );
        throw new Error(error.message);
      }

      this.logger.log(`[Email] Sent "${options.subject}" to ${options.to}`);
    } catch (err) {
      this.logger.error(
        `[Email] Unexpected error sending to ${options.to}`,
        err,
      );
      throw err;
    }
  }

  // ── Transactional templates ───────────────────────────────────────────────

  async sendPasswordResetLink(params: {
    to: string;
    name: string;
    resetUrl: string;
    expiresInMinutes: number;
  }): Promise<void> {
    const { to, name, resetUrl, expiresInMinutes } = params;

    await this.send({
      to,
      subject: 'Reset your Nexlo password',
      text: `Hi ${name},\n\nClick the link below to reset your password. It expires in ${expiresInMinutes} minutes.\n\n${resetUrl}\n\nIf you didn't request this, ignore this email.\n\n— Nexlo Team`,
      html: passwordResetHtml({ name, resetUrl, expiresInMinutes }),
    });
  }
}

// ─── Email template ───────────────────────────────────────────────────────────
// Clean, minimal transactional email. Works in all clients including Gmail.

function passwordResetHtml(params: {
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}): string {
  const { name, resetUrl, expiresInMinutes } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">

          <!-- Header -->
          <tr>
            <td style="background:#18181b;padding:24px 32px;">
              <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Nexlo</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;letter-spacing:-0.5px;">Reset your password</p>
              <p style="margin:0 0 24px;font-size:15px;color:#71717a;line-height:1.6;">
                Hi ${name}, we received a request to reset your password. Click the button below — the link expires in <strong>${expiresInMinutes} minutes</strong>.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#18181b;border-radius:8px;padding:12px 28px;">
                    <a href="${resetUrl}" target="_blank"
                      style="color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;display:inline-block;letter-spacing:0.1px;">
                      Reset password →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 4px;font-size:12px;color:#a1a1aa;">Or copy this link:</p>
              <p style="margin:0 0 24px;font-size:12px;color:#71717a;word-break:break-all;">${resetUrl}</p>

              <hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 20px;" />
              <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.6;">
                If you didn't request a password reset, you can safely ignore this email. Your password won't change.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;background:#fafafa;border-top:1px solid #e4e4e7;">
              <p style="margin:0;font-size:11px;color:#a1a1aa;">
                © ${new Date().getFullYear()} Nexlo · xenlo.app
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
