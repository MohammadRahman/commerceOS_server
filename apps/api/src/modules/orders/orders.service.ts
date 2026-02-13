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
import { ConversationEntity } from '../inbox/entities/conversation.entity';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(OrderEntity) private orders: Repository<OrderEntity>,
    @InjectRepository(OrderEventEntity)
    private events: Repository<OrderEventEntity>,
    @InjectRepository(CustomerEntity)
    private customers: Repository<CustomerEntity>,
    @InjectRepository(ConversationEntity)
    private conversations: Repository<ConversationEntity>,
  ) {}

  async createOrder(
    orgId: string,
    userId: string,
    dto: {
      customerId: string;
      conversationId?: string;
      subtotal?: number;
      deliveryFee?: number;
      currency?: string;
      campaignTag?: string;
      notes?: string;
    },
  ) {
    const customer = await this.customers.findOne({
      where: { id: dto.customerId, orgId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    if (dto.conversationId) {
      const convo = await this.conversations.findOne({
        where: { id: dto.conversationId, orgId },
      });
      if (!convo) throw new NotFoundException('Conversation not found');
    }

    const subtotal = dto.subtotal ?? 0;
    const deliveryFee = dto.deliveryFee ?? 0;
    const total = subtotal + deliveryFee;

    const order = await this.orders.save(
      this.orders.create({
        orgId,
        customerId: customer.id,
        conversationId: dto.conversationId,
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
        data: { userId, fromConversationId: dto.conversationId ?? null },
      }),
    );

    return order;
  }

  async getOrder(orgId: string, id: string) {
    const order = await this.orders.findOne({ where: { id, orgId } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async listOrders(orgId: string, status?: OrderStatus) {
    return this.orders.find({
      where: status ? { orgId, status } : { orgId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async changeStatus(
    orgId: string,
    userId: string,
    orderId: string,
    next: OrderStatus,
  ) {
    const order = await this.getOrder(orgId, orderId);

    const allowed = this.isAllowedTransition(order.status, next);
    if (!allowed)
      throw new BadRequestException(
        `Invalid transition ${order.status} -> ${next}`,
      );

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

  private isAllowedTransition(from: OrderStatus, to: OrderStatus) {
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

  async getTimeline(orgId: string, orderId: string) {
    await this.getOrder(orgId, orderId);
    return this.events.find({
      where: { orgId, orderId },
      order: { createdAt: 'ASC' },
    });
  }
}
