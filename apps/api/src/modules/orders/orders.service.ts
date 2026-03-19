/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/api/src/modules/orders/orders.service.ts — v3
// Fixes:
// 1. createOrder: balanceDue initialised to total, paidAmount to 0, paymentStatus to UNPAID
// 2. changeStatus: payment-aware gates with BD COD business logic
// 3. New endpoint helper: dispatchWithCodCheck — auto-records COD on deliver if agreed

import {
  BadRequestException,
  Injectable,
  Logger,
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

// ─── Payment gate rules ───────────────────────────────────────────────────────
//
// BD COD reality:
//   NEW → CONFIRMED      : always allowed
//   CONFIRMED → PACKED   : always allowed
//   PACKED → DISPATCHED  : soft warn if nothing ever paid AND no payment link
//                          exists — but allow with force flag (COD only agreed)
//   DISPATCHED → DELIVERED: if balanceDue > 0, require explicit COD confirmation
//                           via the /cod-collected endpoint first OR pass
//                           codCollectedAmount in the request body
//   Any terminal → RETURN : always allowed
//   CANCELLED            : always allowed from non-terminal

type PaymentGateResult =
  | { ok: true }
  | { ok: false; code: string; message: string; balanceDue?: number };

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

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

    // ✅ FIX 1: Always initialise financial fields at creation.
    // balanceDue = total (nothing paid yet)
    // paidAmount = 0
    // paymentStatus = UNPAID
    const order = await this.orders.save(
      this.orders.create({
        orgId,
        customerId: customer.id,
        conversationId,
        status: OrderStatus.NEW,
        subtotal,
        deliveryFee,
        total,
        paidAmount: 0,
        balanceDue: total, // ← was missing, caused the bug
        paymentStatus: 'UNPAID', // ← explicit, not relying on DB default
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
          total,
          balanceDue: total,
        },
      }),
    );

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

  /**
   * changeStatus — now payment-aware.
   *
   * DISPATCHED → DELIVERED requires one of:
   *   a) balanceDue === 0 (fully paid already)
   *   b) codCollectedAmount passed in body (seller confirms COD at door)
   *   c) force: true (seller explicitly overrides — creates audit event)
   *
   * PACKED → DISPATCHED:
   *   - Warns if balanceDue === total (nothing ever paid, no advance)
   *   - Allowed via force: true for pure COD orders
   */
  async changeStatus(
    orgId: string,
    userId: string,
    orderId: string,
    next: OrderStatus,
    opts: {
      force?: boolean;
      codCollectedAmount?: number;
      note?: string;
    } = {},
  ) {
    const order = await this.getOrder(orgId, orderId);

    if (!this.isAllowedTransition(order.status, next)) {
      throw new BadRequestException(
        `Invalid transition ${order.status} → ${next}`,
      );
    }

    // ✅ FIX 2: Payment gates
    const gate = this.checkPaymentGate(order, next, opts);
    if (!gate.ok) {
      throw new BadRequestException({
        code: gate.code,
        message: gate.message,
        balanceDue: gate.balanceDue,
      });
    }

    // If COD collected amount is passed with DELIVERED, record it first
    if (
      next === OrderStatus.DELIVERED &&
      opts.codCollectedAmount &&
      opts.codCollectedAmount > 0
    ) {
      await this._recordCodInternal(
        orgId,
        userId,
        order,
        opts.codCollectedAmount,
        opts.note,
      );
      // Re-fetch order to get updated payment fields
      const refreshed = await this.getOrder(orgId, orderId);
      await this.orders.update({ id: order.id, orgId }, { status: next });
      await this.events.save(
        this.events.create({
          orgId,
          orderId: order.id,
          type: 'ORDER_STATUS_CHANGED',
          data: {
            userId,
            from: order.status,
            to: next,
            codCollectedWithDelivery: opts.codCollectedAmount,
            forced: opts.force ?? false,
          },
        }),
      );
      return this.getOrder(orgId, orderId);
    }

    // If force-delivering with outstanding balance, log the override
    if (
      next === OrderStatus.DELIVERED &&
      (order.balanceDue ?? 0) > 0 &&
      opts.force
    ) {
      this.logger.warn(
        `[Orders] Force-delivered order ${orderId} with balanceDue=${order.balanceDue} by userId=${userId}`,
      );
      await this.events.save(
        this.events.create({
          orgId,
          orderId: order.id,
          type: 'PAYMENT_OVERRIDE',
          data: {
            userId,
            balanceDue: order.balanceDue,
            paidAmount: order.paidAmount,
            reason: opts.note ?? 'Force delivered by operator',
          },
        }),
      );
    }

    await this.orders.update({ id: order.id, orgId }, { status: next });
    await this.events.save(
      this.events.create({
        orgId,
        orderId: order.id,
        type: 'ORDER_STATUS_CHANGED',
        data: {
          userId,
          from: order.status,
          to: next,
          forced: opts.force ?? false,
        },
      }),
    );

    return this.getOrder(orgId, orderId);
  }

  // ─── Payment gate logic ───────────────────────────────────────────────────

  private checkPaymentGate(
    order: OrderEntity,
    next: OrderStatus,
    opts: { force?: boolean; codCollectedAmount?: number },
  ): PaymentGateResult {
    const balanceDue = order.balanceDue ?? 0;
    const total = order.total ?? 0;

    // PACKED → DISPATCHED:
    // Soft check — warn if seller hasn't sent any payment link
    // and full amount is still due. Allow with force for COD-only orders.
    if (next === OrderStatus.DISPATCHED) {
      if (balanceDue === total && total > 0 && !opts.force) {
        return {
          ok: false,
          code: 'NO_PAYMENT_INITIATED',
          message: `Full amount of ${total} BDT is still due. If this is a COD-only order, confirm to proceed.`,
          balanceDue: total,
        };
      }
      return { ok: true };
    }

    // DISPATCHED → DELIVERED:
    // Hard check — require either:
    //   a) already fully paid
    //   b) COD collected amount passed
    //   c) force override (creates audit trail)
    if (next === OrderStatus.DELIVERED) {
      if (balanceDue === 0) return { ok: true }; // fully paid
      if (opts.codCollectedAmount && opts.codCollectedAmount >= balanceDue)
        return { ok: true }; // COD covers remainder
      if (opts.force) return { ok: true }; // operator override

      return {
        ok: false,
        code: 'BALANCE_DUE_ON_DELIVERY',
        message: `${balanceDue} BDT is still due. Confirm COD collection or mark as force-delivered.`,
        balanceDue,
      };
    }

    // All other transitions — no payment gate
    return { ok: true };
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

  // ─── COD Collection ────────────────────────────────────────────────────────

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

    await this._recordCodInternal(orgId, userId, order, collectedAmount, note);

    const updated = await this.orders.findOne({
      where: { id: orderId, orgId },
    });
    return {
      collected: true,
      collectedAmount,
      paidAmount: updated!.paidAmount,
      balanceDue: updated!.balanceDue,
      paymentStatus: updated!.paymentStatus,
    };
  }

  /** Internal — mutates order in DB, saves event. Does NOT re-fetch. */
  private async _recordCodInternal(
    orgId: string,
    userId: string,
    order: OrderEntity,
    collectedAmount: number,
    note?: string,
  ) {
    const newPaid = (order.paidAmount ?? 0) + collectedAmount;
    const newBalance = Math.max(0, (order.total ?? 0) - newPaid);
    const paymentStatus: OrderEntity['paymentStatus'] =
      newBalance === 0 ? 'PAID' : newPaid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';

    await this.orders.update(
      { id: order.id, orgId },
      { paidAmount: newPaid, balanceDue: newBalance, paymentStatus },
    );

    await this.events.save(
      this.events.create({
        orgId,
        orderId: order.id,
        type: 'COD_COLLECTED',
        data: {
          collectedBy: userId,
          collectedAmount,
          paidAmount: newPaid,
          balanceDue: newBalance,
          paymentStatus,
          note: note ?? null,
        },
      }),
    );
  }

  // ─── Customer resolution ───────────────────────────────────────────────────

  private async resolveCustomerFromConversation(
    orgId: string,
    conversationId: string,
  ): Promise<{ customer: CustomerEntity; conversationId: string }> {
    const conversation = await this.conversations.findOne({
      where: { id: conversationId, orgId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (conversation.channelId && conversation.externalUserId) {
      const identity = await this.identities.findOne({
        where: {
          channelId: conversation.channelId,
          externalUserId: conversation.externalUserId,
          orgId,
        },
        relations: ['customer'],
      });
      if (identity?.customer)
        return { customer: identity.customer, conversationId };
    }

    throw new NotFoundException(
      'Could not resolve customer from conversation. Ensure the conversation has an associated customer identity.',
    );
  }

  private async resolveOrCreateCustomerByPhone(
    orgId: string,
    phone: string,
    customerName?: string,
  ): Promise<{ customer: CustomerEntity; conversationId: undefined }> {
    const normalizedName = customerName?.trim().toLowerCase();

    const existing = await this.customers.find({
      where: { orgId, phone },
      order: { createdAt: 'DESC' },
    });

    if (existing.length > 0) {
      if (!normalizedName)
        return { customer: existing[0], conversationId: undefined };
      const match = existing.find(
        (c) => c.name?.trim().toLowerCase() === normalizedName,
      );
      if (match) return { customer: match, conversationId: undefined };
    }

    const customer = await this.customers.save(
      this.customers.create({ orgId, phone, name: customerName?.trim() }),
    );
    return { customer, conversationId: undefined };
  }
}
// // v2
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
// import { CustomerIdentityEntity } from '../inbox/entities/customer-identity.entity';
// import { ConversationEntity } from '../inbox/entities/conversation.entity';
// import { CreateOrderDto } from './dto/create-order.dto';

// @Injectable()
// export class OrdersService {
//   constructor(
//     @InjectRepository(OrderEntity)
//     private orders: Repository<OrderEntity>,

//     @InjectRepository(OrderEventEntity)
//     private events: Repository<OrderEventEntity>,

//     @InjectRepository(CustomerEntity)
//     private customers: Repository<CustomerEntity>,

//     @InjectRepository(CustomerIdentityEntity)
//     private identities: Repository<CustomerIdentityEntity>,

//     @InjectRepository(ConversationEntity)
//     private conversations: Repository<ConversationEntity>,
//   ) {}

//   // ─── Create ────────────────────────────────────────────────────────────────

//   async createOrder(orgId: string, userId: string, dto: CreateOrderDto) {
//     if (!dto.conversationId && !dto.phone) {
//       throw new BadRequestException(
//         'Either conversationId (inbox flow) or phone (standalone flow) is required.',
//       );
//     }

//     const { customer, conversationId } = dto.conversationId
//       ? await this.resolveCustomerFromConversation(orgId, dto.conversationId)
//       : await this.resolveOrCreateCustomerByPhone(
//           orgId,
//           dto.phone!,
//           dto.customerName,
//         );

//     const subtotal = dto.subtotal ?? 0;
//     const deliveryFee = dto.deliveryFee ?? 0;
//     const total = subtotal + deliveryFee;

//     const order = await this.orders.save(
//       this.orders.create({
//         orgId,
//         customerId: customer.id,
//         conversationId,
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
//         data: {
//           userId,
//           fromConversationId: conversationId ?? null,
//           customerName: customer.name ?? null,
//           phone: customer.phone ?? null,
//         },
//       }),
//     );

//     // Return order with customer relation eagerly attached
//     // so the caller gets name/phone without a second query
//     return this.orders.findOne({
//       where: { id: order.id, orgId },
//       relations: ['customer'],
//     });
//   }

//   // ─── Read ──────────────────────────────────────────────────────────────────

//   async getOrder(orgId: string, id: string) {
//     const order = await this.orders.findOne({
//       where: { id, orgId },
//       relations: ['customer'],
//     });
//     if (!order) throw new NotFoundException('Order not found');
//     return order;
//   }

//   async listOrders(orgId: string, status?: OrderStatus) {
//     return this.orders.find({
//       where: status ? { orgId, status } : { orgId },
//       relations: ['customer'],
//       order: { createdAt: 'DESC' },
//       take: 100,
//     });
//   }

//   // ─── Status transitions ────────────────────────────────────────────────────

//   async changeStatus(
//     orgId: string,
//     userId: string,
//     orderId: string,
//     next: OrderStatus,
//   ) {
//     const order = await this.getOrder(orgId, orderId);

//     if (!this.isAllowedTransition(order.status, next)) {
//       throw new BadRequestException(
//         `Invalid transition ${order.status} → ${next}`,
//       );
//     }

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

//   private isAllowedTransition(from: OrderStatus, to: OrderStatus): boolean {
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

//   // ─── Timeline ──────────────────────────────────────────────────────────────

//   async getTimeline(orgId: string, orderId: string) {
//     await this.getOrder(orgId, orderId);
//     return this.events.find({
//       where: { orgId, orderId },
//       order: { createdAt: 'ASC' },
//     });
//   }

//   // ─── Private: customer resolution ─────────────────────────────────────────

//   /**
//    * Inbox flow.
//    *
//    * Walk: conversation → customer_identities (channelId + externalUserId)
//    * → customer. The conversation record stores both externalUserId and
//    * channelId so the join is a single query.
//    *
//    * Falls back to conversation.customerId if the identity row is missing
//    * (e.g. legacy data or direct API creation).
//    */
//   private async resolveCustomerFromConversation(
//     orgId: string,
//     conversationId: string,
//   ): Promise<{ customer: CustomerEntity; conversationId: string }> {
//     const conversation = await this.conversations.findOne({
//       where: { id: conversationId, orgId },
//     });
//     if (!conversation) throw new NotFoundException('Conversation not found');

//     // Try to resolve via customer_identities first
//     const identity = await this.identities.findOne({
//       where: {
//         channelId: conversation.channelId,
//         externalUserId: conversation.externalUserId,
//         orgId,
//       },
//       relations: ['customer'],
//     });

//     if (identity?.customer) {
//       return { customer: identity.customer, conversationId };
//     }

//     // Fallback: conversation may already carry a direct customerId
//     // if (conversation.customerId) {
//     //   const customer = await this.customers.findOne({
//     //     where: { id: conversation.customerId, orgId },
//     //   });
//     //   if (customer) return { customer, conversationId };
//     // }

//     if (conversation.channelId && conversation.externalUserId) {
//       const identity = await this.identities.findOne({
//         where: {
//           channelId: conversation.channelId,
//           externalUserId: conversation.externalUserId,
//           orgId,
//         },
//         relations: ['customer'],
//       });

//       if (identity?.customer) {
//         return { customer: identity.customer, conversationId };
//       }
//     }

//     throw new NotFoundException(
//       'Could not resolve customer from conversation. ' +
//         'Ensure the conversation has an associated customer identity.',
//     );
//   }

//   /**
//    * Standalone flow.
//    *
//    * Find customer by phone within the org.
//    * If not found, create a new customer record (find-or-create).
//    */
//   // private async resolveOrCreateCustomerByPhone(
//   //   orgId: string,
//   //   phone: string,
//   //   customerName?: string,
//   // ): Promise<{ customer: CustomerEntity; conversationId: undefined }> {
//   //   const existing = await this.customers.findOne({
//   //     where: { orgId, phone },
//   //   });

//   //   if (existing) {
//   //     // Optionally backfill name if it was missing
//   //     if (!existing.name && customerName) {
//   //       await this.customers.update(
//   //         { id: existing.id },
//   //         { name: customerName },
//   //       );
//   //       existing.name = customerName;
//   //     }
//   //     return { customer: existing, conversationId: undefined };
//   //   }

//   //   // Create new customer
//   //   const customer = await this.customers.save(
//   //     this.customers.create({
//   //       orgId,
//   //       phone,
//   //       name: customerName,
//   //     }),
//   //   );

//   //   return { customer, conversationId: undefined };
//   // }
//   private async resolveOrCreateCustomerByPhone(
//     orgId: string,
//     phone: string,
//     customerName?: string,
//   ): Promise<{ customer: CustomerEntity; conversationId: undefined }> {
//     // Normalize name for comparison — trim + lowercase
//     const normalizedName = customerName?.trim().toLowerCase();

//     // Find all customers with this phone in the org
//     const existing = await this.customers.find({
//       where: { orgId, phone },
//       order: { createdAt: 'DESC' },
//     });

//     if (existing.length > 0) {
//       if (!normalizedName) {
//         // No name provided — reuse most recent customer with this phone
//         return { customer: existing[0], conversationId: undefined };
//       }

//       // Find one whose name matches (case-insensitive)
//       const match = existing.find(
//         (c) => c.name?.trim().toLowerCase() === normalizedName,
//       );

//       if (match) {
//         // Exact phone + name match — same customer
//         return { customer: match, conversationId: undefined };
//       }

//       // Same phone, different name — new person ordering
//       // Fall through to create a new customer record below
//     }

//     // Create new customer — either first time or different name
//     const customer = await this.customers.save(
//       this.customers.create({
//         orgId,
//         phone,
//         name: customerName?.trim(),
//       }),
//     );

//     return { customer, conversationId: undefined };
//   }

//   async recordCodCollection(
//     orgId: string,
//     userId: string,
//     orderId: string,
//     collectedAmount: number,
//     note?: string,
//   ) {
//     const order = await this.orders.findOne({ where: { id: orderId, orgId } });
//     if (!order) throw new NotFoundException('Order not found');

//     if (!['DISPATCHED', 'DELIVERED'].includes(order.status)) {
//       throw new BadRequestException(
//         'COD can only be collected for dispatched or delivered orders',
//       );
//     }

//     if (collectedAmount <= 0) {
//       throw new BadRequestException('Collected amount must be > 0');
//     }

//     // Add collected cash to paidAmount, reduce balanceDue
//     order.paidAmount = (order.paidAmount ?? 0) + collectedAmount;
//     order.balanceDue = Math.max(0, order.total - order.paidAmount);
//     order.paymentStatus =
//       order.balanceDue === 0
//         ? 'PAID'
//         : order.paidAmount > 0
//           ? 'PARTIALLY_PAID'
//           : 'UNPAID';

//     await this.orders.save(order);

//     await this.events.save(
//       this.events.create({
//         orgId,
//         orderId: order.id,
//         type: 'COD_COLLECTED',
//         data: {
//           collectedBy: userId,
//           collectedAmount,
//           paidAmount: order.paidAmount,
//           balanceDue: order.balanceDue,
//           paymentStatus: order.paymentStatus,
//           note: note ?? null,
//         },
//       }),
//     );

//     return {
//       collected: true,
//       collectedAmount,
//       paidAmount: order.paidAmount,
//       balanceDue: order.balanceDue,
//       paymentStatus: order.paymentStatus,
//     };
//   }
// }
