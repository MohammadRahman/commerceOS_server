// v2
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderEntity, OrderStatus } from './entities/order.entity';
import { OrderEventEntity } from './entities/order-event.entity';
import { CustomerEntity } from '../inbox/entities/customer.entity';
import { CustomerIdentityEntity } from '../inbox/entities/customer-identity.entity';
import { ConversationEntity } from '../inbox/entities/conversation.entity';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(OrderEntity)
    private orders: Repository<OrderEntity>,

    @InjectRepository(OrderEventEntity)
    private events: Repository<OrderEventEntity>,

    @InjectRepository(CustomerEntity)
    private customers: Repository<CustomerEntity>,

    @InjectRepository(CustomerIdentityEntity)
    private identities: Repository<CustomerIdentityEntity>,

    @InjectRepository(ConversationEntity)
    private conversations: Repository<ConversationEntity>,
  ) {}

  // ─── Create ────────────────────────────────────────────────────────────────

  async createOrder(orgId: string, userId: string, dto: CreateOrderDto) {
    if (!dto.conversationId && !dto.phone) {
      throw new BadRequestException(
        'Either conversationId (inbox flow) or phone (standalone flow) is required.',
      );
    }

    const { customer, conversationId } = dto.conversationId
      ? await this.resolveCustomerFromConversation(orgId, dto.conversationId)
      : await this.resolveOrCreateCustomerByPhone(
          orgId,
          dto.phone!,
          dto.customerName,
        );

    const subtotal = dto.subtotal ?? 0;
    const deliveryFee = dto.deliveryFee ?? 0;
    const total = subtotal + deliveryFee;

    const order = await this.orders.save(
      this.orders.create({
        orgId,
        customerId: customer.id,
        conversationId,
        status: OrderStatus.NEW,
        subtotal,
        deliveryFee,
        total,
        currency: dto.currency ?? 'BDT',
        campaignTag: dto.campaignTag,
        notes: dto.notes,
      }),
    );

    await this.events.save(
      this.events.create({
        orgId,
        orderId: order.id,
        type: 'ORDER_CREATED',
        data: {
          userId,
          fromConversationId: conversationId ?? null,
          customerName: customer.name ?? null,
          phone: customer.phone ?? null,
        },
      }),
    );

    // Return order with customer relation eagerly attached
    // so the caller gets name/phone without a second query
    return this.orders.findOne({
      where: { id: order.id, orgId },
      relations: ['customer'],
    });
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  async getOrder(orgId: string, id: string) {
    const order = await this.orders.findOne({
      where: { id, orgId },
      relations: ['customer'],
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async listOrders(orgId: string, status?: OrderStatus) {
    return this.orders.find({
      where: status ? { orgId, status } : { orgId },
      relations: ['customer'],
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  // ─── Status transitions ────────────────────────────────────────────────────

  async changeStatus(
    orgId: string,
    userId: string,
    orderId: string,
    next: OrderStatus,
  ) {
    const order = await this.getOrder(orgId, orderId);

    if (!this.isAllowedTransition(order.status, next)) {
      throw new BadRequestException(
        `Invalid transition ${order.status} → ${next}`,
      );
    }

    await this.orders.update({ id: order.id, orgId }, { status: next });

    await this.events.save(
      this.events.create({
        orgId,
        orderId: order.id,
        type: 'ORDER_STATUS_CHANGED',
        data: { userId, from: order.status, to: next },
      }),
    );

    return this.getOrder(orgId, orderId);
  }

  private isAllowedTransition(from: OrderStatus, to: OrderStatus): boolean {
    const map: Record<OrderStatus, OrderStatus[]> = {
      NEW: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
      CONFIRMED: [OrderStatus.PACKED, OrderStatus.CANCELLED],
      PACKED: [OrderStatus.DISPATCHED, OrderStatus.CANCELLED],
      DISPATCHED: [
        OrderStatus.DELIVERED,
        OrderStatus.FAILED_DELIVERY,
        OrderStatus.RETURNED,
      ],
      DELIVERED: [OrderStatus.RETURNED],
      FAILED_DELIVERY: [OrderStatus.RETURNED],
      CANCELLED: [],
      RETURNED: [],
    };
    return (map[from] ?? []).includes(to);
  }

  // ─── Timeline ──────────────────────────────────────────────────────────────

  async getTimeline(orgId: string, orderId: string) {
    await this.getOrder(orgId, orderId);
    return this.events.find({
      where: { orgId, orderId },
      order: { createdAt: 'ASC' },
    });
  }

  // ─── Private: customer resolution ─────────────────────────────────────────

  /**
   * Inbox flow.
   *
   * Walk: conversation → customer_identities (channelId + externalUserId)
   * → customer. The conversation record stores both externalUserId and
   * channelId so the join is a single query.
   *
   * Falls back to conversation.customerId if the identity row is missing
   * (e.g. legacy data or direct API creation).
   */
  private async resolveCustomerFromConversation(
    orgId: string,
    conversationId: string,
  ): Promise<{ customer: CustomerEntity; conversationId: string }> {
    const conversation = await this.conversations.findOne({
      where: { id: conversationId, orgId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    // Try to resolve via customer_identities first
    const identity = await this.identities.findOne({
      where: {
        channelId: conversation.channelId,
        externalUserId: conversation.externalUserId,
        orgId,
      },
      relations: ['customer'],
    });

    if (identity?.customer) {
      return { customer: identity.customer, conversationId };
    }

    // Fallback: conversation may already carry a direct customerId
    // if (conversation.customerId) {
    //   const customer = await this.customers.findOne({
    //     where: { id: conversation.customerId, orgId },
    //   });
    //   if (customer) return { customer, conversationId };
    // }

    if (conversation.channelId && conversation.externalUserId) {
      const identity = await this.identities.findOne({
        where: {
          channelId: conversation.channelId,
          externalUserId: conversation.externalUserId,
          orgId,
        },
        relations: ['customer'],
      });

      if (identity?.customer) {
        return { customer: identity.customer, conversationId };
      }
    }

    throw new NotFoundException(
      'Could not resolve customer from conversation. ' +
        'Ensure the conversation has an associated customer identity.',
    );
  }

  /**
   * Standalone flow.
   *
   * Find customer by phone within the org.
   * If not found, create a new customer record (find-or-create).
   */
  // private async resolveOrCreateCustomerByPhone(
  //   orgId: string,
  //   phone: string,
  //   customerName?: string,
  // ): Promise<{ customer: CustomerEntity; conversationId: undefined }> {
  //   const existing = await this.customers.findOne({
  //     where: { orgId, phone },
  //   });

  //   if (existing) {
  //     // Optionally backfill name if it was missing
  //     if (!existing.name && customerName) {
  //       await this.customers.update(
  //         { id: existing.id },
  //         { name: customerName },
  //       );
  //       existing.name = customerName;
  //     }
  //     return { customer: existing, conversationId: undefined };
  //   }

  //   // Create new customer
  //   const customer = await this.customers.save(
  //     this.customers.create({
  //       orgId,
  //       phone,
  //       name: customerName,
  //     }),
  //   );

  //   return { customer, conversationId: undefined };
  // }
  private async resolveOrCreateCustomerByPhone(
    orgId: string,
    phone: string,
    customerName?: string,
  ): Promise<{ customer: CustomerEntity; conversationId: undefined }> {
    // Normalize name for comparison — trim + lowercase
    const normalizedName = customerName?.trim().toLowerCase();

    // Find all customers with this phone in the org
    const existing = await this.customers.find({
      where: { orgId, phone },
      order: { createdAt: 'DESC' },
    });

    if (existing.length > 0) {
      if (!normalizedName) {
        // No name provided — reuse most recent customer with this phone
        return { customer: existing[0], conversationId: undefined };
      }

      // Find one whose name matches (case-insensitive)
      const match = existing.find(
        (c) => c.name?.trim().toLowerCase() === normalizedName,
      );

      if (match) {
        // Exact phone + name match — same customer
        return { customer: match, conversationId: undefined };
      }

      // Same phone, different name — new person ordering
      // Fall through to create a new customer record below
    }

    // Create new customer — either first time or different name
    const customer = await this.customers.save(
      this.customers.create({
        orgId,
        phone,
        name: customerName?.trim(),
      }),
    );

    return { customer, conversationId: undefined };
  }

  async recordCodCollection(
    orgId: string,
    userId: string,
    orderId: string,
    collectedAmount: number,
    note?: string,
  ) {
    const order = await this.orders.findOne({ where: { id: orderId, orgId } });
    if (!order) throw new NotFoundException('Order not found');

    if (!['DISPATCHED', 'DELIVERED'].includes(order.status)) {
      throw new BadRequestException(
        'COD can only be collected for dispatched or delivered orders',
      );
    }

    if (collectedAmount <= 0) {
      throw new BadRequestException('Collected amount must be > 0');
    }

    // Add collected cash to paidAmount, reduce balanceDue
    order.paidAmount = (order.paidAmount ?? 0) + collectedAmount;
    order.balanceDue = Math.max(0, order.total - order.paidAmount);
    order.paymentStatus =
      order.balanceDue === 0
        ? 'PAID'
        : order.paidAmount > 0
          ? 'PARTIALLY_PAID'
          : 'UNPAID';

    await this.orders.save(order);

    await this.events.save(
      this.events.create({
        orgId,
        orderId: order.id,
        type: 'COD_COLLECTED',
        data: {
          collectedBy: userId,
          collectedAmount,
          paidAmount: order.paidAmount,
          balanceDue: order.balanceDue,
          paymentStatus: order.paymentStatus,
          note: note ?? null,
        },
      }),
    );

    return {
      collected: true,
      collectedAmount,
      paidAmount: order.paidAmount,
      balanceDue: order.balanceDue,
      paymentStatus: order.paymentStatus,
    };
  }
}
// v1
// import {
//   BadRequestException,
//   Injectable,
//   NotFoundException,
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { OrderEntity, OrderStatus } from './entities/order.entity';
// import { OrderEventEntity } from './entities/order-event.entity';
// import { CustomerEntity } from '../inbox/entities/customer.entity';
// import { ConversationEntity } from '../inbox/entities/conversation.entity';

// @Injectable()
// export class OrdersService {
//   constructor(
//     @InjectRepository(OrderEntity) private orders: Repository<OrderEntity>,
//     @InjectRepository(OrderEventEntity)
//     private events: Repository<OrderEventEntity>,
//     @InjectRepository(CustomerEntity)
//     private customers: Repository<CustomerEntity>,
//     @InjectRepository(ConversationEntity)
//     private conversations: Repository<ConversationEntity>,
//   ) {}

//   async createOrder(
//     orgId: string,
//     userId: string,
//     dto: {
//       customerId: string;
//       conversationId?: string;
//       subtotal?: number;
//       deliveryFee?: number;
//       currency?: string;
//       campaignTag?: string;
//       notes?: string;
//     },
//   ) {
//     const customer = await this.customers.findOne({
//       where: { id: dto.customerId, orgId },
//     });
//     if (!customer) throw new NotFoundException('Customer not found');

//     if (dto.conversationId) {
//       const convo = await this.conversations.findOne({
//         where: { id: dto.conversationId, orgId },
//       });
//       if (!convo) throw new NotFoundException('Conversation not found');
//     }

//     const subtotal = dto.subtotal ?? 0;
//     const deliveryFee = dto.deliveryFee ?? 0;
//     const total = subtotal + deliveryFee;

//     const order = await this.orders.save(
//       this.orders.create({
//         orgId,
//         customerId: customer.id,
//         conversationId: dto.conversationId,
//         status: OrderStatus.NEW,
//         subtotal,
//         deliveryFee,
//         total,
//         currency: dto.currency ?? 'BDT',
//         campaignTag: dto.campaignTag,
//         notes: dto.notes,
//       }),
//     );

//     await this.events.save(
//       this.events.create({
//         orgId,
//         orderId: order.id,
//         type: 'ORDER_CREATED',
//         data: { userId, fromConversationId: dto.conversationId ?? null },
//       }),
//     );

//     return order;
//   }

//   async getOrder(orgId: string, id: string) {
//     const order = await this.orders.findOne({ where: { id, orgId } });
//     if (!order) throw new NotFoundException('Order not found');
//     return order;
//   }

//   async listOrders(orgId: string, status?: OrderStatus) {
//     return this.orders.find({
//       where: status ? { orgId, status } : { orgId },
//       order: { createdAt: 'DESC' },
//       take: 100,
//     });
//   }

//   async changeStatus(
//     orgId: string,
//     userId: string,
//     orderId: string,
//     next: OrderStatus,
//   ) {
//     const order = await this.getOrder(orgId, orderId);

//     const allowed = this.isAllowedTransition(order.status, next);
//     if (!allowed)
//       throw new BadRequestException(
//         `Invalid transition ${order.status} -> ${next}`,
//       );

//     await this.orders.update({ id: order.id, orgId }, { status: next });

//     await this.events.save(
//       this.events.create({
//         orgId,
//         orderId: order.id,
//         type: 'ORDER_STATUS_CHANGED',
//         data: { userId, from: order.status, to: next },
//       }),
//     );

//     return this.getOrder(orgId, orderId);
//   }

//   private isAllowedTransition(from: OrderStatus, to: OrderStatus) {
//     const map: Record<OrderStatus, OrderStatus[]> = {
//       NEW: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
//       CONFIRMED: [OrderStatus.PACKED, OrderStatus.CANCELLED],
//       PACKED: [OrderStatus.DISPATCHED, OrderStatus.CANCELLED],
//       DISPATCHED: [
//         OrderStatus.DELIVERED,
//         OrderStatus.FAILED_DELIVERY,
//         OrderStatus.RETURNED,
//       ],
//       DELIVERED: [OrderStatus.RETURNED],
//       FAILED_DELIVERY: [OrderStatus.RETURNED],
//       CANCELLED: [],
//       RETURNED: [],
//     };
//     return (map[from] ?? []).includes(to);
//   }

//   async getTimeline(orgId: string, orderId: string) {
//     await this.getOrder(orgId, orderId);
//     return this.events.find({
//       where: { orgId, orderId },
//       order: { createdAt: 'ASC' },
//     });
//   }
// }
