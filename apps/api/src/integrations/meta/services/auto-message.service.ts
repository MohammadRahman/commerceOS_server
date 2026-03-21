/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/integrations/meta/services/auto-message.service.ts
// Automatically sends a message to the customer on the same channel
// when an order, payment link, shipment is created or status changes.
// Non-fatal — if sending fails it logs but never throws.
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationEntity } from 'apps/api/src/modules/inbox/entities/conversation.entity';
import { CustomerIdentityEntity } from 'apps/api/src/modules/inbox/entities/customer-identity.entity';
import { InboxService } from './inbox.service';

@Injectable()
export class AutoMessageService {
  private readonly logger = new Logger(AutoMessageService.name);

  constructor(
    private inbox: InboxService,
    @InjectRepository(ConversationEntity)
    private conversations: Repository<ConversationEntity>,
    @InjectRepository(CustomerIdentityEntity)
    private identities: Repository<CustomerIdentityEntity>,
  ) {}

  // ── Find active conversation for a customer ───────────────────────────────

  private async findConversation(
    orgId: string,
    customerId: string,
  ): Promise<ConversationEntity | null> {
    // Find via customer_identity → channel → conversation
    const identity = await this.identities.findOne({
      where: { orgId, customerId } as any,
    });
    if (!identity) return null;

    return this.conversations.findOne({
      where: {
        orgId,
        channelId: identity.channelId,
        externalUserId: identity.externalUserId,
      } as any,
      order: { lastMessageAt: 'DESC' } as any,
    });
  }

  private async send(
    orgId: string,
    customerId: string,
    text: string,
  ): Promise<void> {
    try {
      const convo = await this.findConversation(orgId, customerId);
      if (!convo) {
        this.logger.debug(
          `[AutoMessage] No conversation found for customerId=${customerId} — skipping`,
        );
        return;
      }
      await this.inbox.sendMessage(orgId, convo.id, text);
      this.logger.log(
        `[AutoMessage] Sent to convo=${convo.id} customer=${customerId}`,
      );
    } catch (e: any) {
      // Never throw — auto-messages are best-effort
      this.logger.warn(
        `[AutoMessage] Failed to send: ${e?.message ?? 'unknown error'}`,
      );
    }
  }

  // ── Triggers ──────────────────────────────────────────────────────────────

  async onOrderCreated(order: {
    id: string;
    orgId: string;
    customerId: string;
    total: number;
    currency: string;
  }): Promise<void> {
    const shortId = order.id.slice(0, 8).toUpperCase();
    const text =
      `✅ Your order #${shortId} has been received!\n\n` +
      `Total: ${order.total.toLocaleString()} ${order.currency}\n\n` +
      `We'll confirm it shortly. Thank you! 🙏`;

    await this.send(order.orgId, order.customerId, text);
  }

  async onPaymentLinkCreated(
    link: {
      id: string;
      orgId: string;
      orderId: string;
      amount: number;
      url?: string | null;
      provider: string;
    },
    order: {
      customerId: string;
      currency: string;
      total: number;
      balanceDue: number;
    },
  ): Promise<void> {
    const shortOrderId = link.orderId.slice(0, 8).toUpperCase();
    const payUrl = link.url ?? '(generating…)';

    const text =
      `💳 Payment request for order #${shortOrderId}\n\n` +
      `Order total: ${order.total.toLocaleString()} ${order.currency}\n` +
      `Amount due: ${order.balanceDue.toLocaleString()} ${order.currency}\n` +
      `Provider: ${link.provider.toUpperCase()}\n\n` +
      `Pay here 👇\n${payUrl}\n\n` +
      `Link expires in 24 hours.`;

    await this.send(link.orgId, order.customerId, text);
  }

  async onCourierBooked(
    shipment: {
      id: string;
      orgId: string;
      orderId: string;
      courierProvider: string;
      consignmentId?: string | null;
    },
    order: { customerId: string },
  ): Promise<void> {
    const shortOrderId = shipment.orderId.slice(0, 8).toUpperCase();
    const tracking = shipment.consignmentId
      ? `Tracking ID: ${shipment.consignmentId}`
      : `Tracking will be available shortly.`;

    const text =
      `🚚 Order #${shortOrderId} has been dispatched!\n\n` +
      `Courier: ${shipment.courierProvider.toUpperCase()}\n` +
      `${tracking}\n\n` +
      `We'll keep you updated on delivery. 📦`;

    await this.send(shipment.orgId, order.customerId, text);
  }

  async onStatusChanged(
    order: {
      id: string;
      orgId: string;
      customerId: string;
      total: number;
      currency: string;
    },
    newStatus: string,
  ): Promise<void> {
    const shortId = order.id.slice(0, 8).toUpperCase();

    const messages: Record<string, string> = {
      CONFIRMED:
        `✅ Order #${shortId} confirmed!\n\n` +
        `Total: ${order.total.toLocaleString()} ${order.currency}\n` +
        `We're preparing your package. 📦`,

      DISPATCHED:
        `🚚 Order #${shortId} is on its way!\n\n` +
        `Your package has been handed to the courier.\n` +
        `We'll notify you once it's delivered.`,

      DELIVERED:
        `📦 Order #${shortId} has been delivered!\n\n` +
        `Thank you for shopping with us. We hope you love your order! 🙏\n` +
        `If you have any issues, just reply here.`,
    };

    const text = messages[newStatus];
    if (!text) return; // no message for other statuses

    await this.send(order.orgId, order.customerId, text);
  }
}
