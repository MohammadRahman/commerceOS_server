/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NestFactory } from '@nestjs/core';

import { getRepositoryToken } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

// Tenancy
import { OrganizationEntity } from './modules/tenancy/entities/organization.entity';
import { UserEntity, UserRole } from './modules/tenancy/entities/user.entity';

// Inbox
import {
  ChannelEntity,
  ChannelType,
} from './modules/inbox/entities/channel.entity';
import { CustomerEntity } from './modules/inbox/entities/customer.entity';
import { ConversationEntity } from './modules/inbox/entities/conversation.entity';
import {
  MessageEntity,
  MessageDirection,
} from './modules/inbox/entities/message.entity';

// Orders
import {
  OrderEntity,
  OrderStatus,
} from './modules/orders/entities/order.entity';
import { OrderEventEntity } from './modules/orders/entities/order-event.entity';

// Payments
import { PaymentLinkEntity } from './modules/payments/entities/payment-link.entity';
import { PaymentEventEntity } from './modules/payments/entities/payment-event.entity';

// Shipments
import {
  ShipmentEntity,
  ShipmentStatus,
} from './modules/shipments/entities/shipment.entity';
import { ShipmentEventEntity } from './modules/shipments/entities/shipment-event.entity';

// Outbox (libs/common)
import {
  OutboxEventEntity,
  OutboxStatus,
} from '@app/common/outbox/outbox-event.entity';
import { AppModule } from './api.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const orgRepo = app.get<Repository<OrganizationEntity>>(
    getRepositoryToken(OrganizationEntity),
  );
  const userRepo = app.get<Repository<UserEntity>>(
    getRepositoryToken(UserEntity),
  );

  const channelRepo = app.get<Repository<ChannelEntity>>(
    getRepositoryToken(ChannelEntity),
  );
  const customerRepo = app.get<Repository<CustomerEntity>>(
    getRepositoryToken(CustomerEntity),
  );
  const convoRepo = app.get<Repository<ConversationEntity>>(
    getRepositoryToken(ConversationEntity),
  );
  const msgRepo = app.get<Repository<MessageEntity>>(
    getRepositoryToken(MessageEntity),
  );

  const orderRepo = app.get<Repository<OrderEntity>>(
    getRepositoryToken(OrderEntity),
  );
  const orderEventRepo = app.get<Repository<OrderEventEntity>>(
    getRepositoryToken(OrderEventEntity),
  );

  const payLinkRepo = app.get<Repository<PaymentLinkEntity>>(
    getRepositoryToken(PaymentLinkEntity),
  );
  const payEventRepo = app.get<Repository<PaymentEventEntity>>(
    getRepositoryToken(PaymentEventEntity),
  );

  const shipmentRepo = app.get<Repository<ShipmentEntity>>(
    getRepositoryToken(ShipmentEntity),
  );
  const shipmentEventRepo = app.get<Repository<ShipmentEventEntity>>(
    getRepositoryToken(ShipmentEventEntity),
  );

  const outboxRepo = app.get<Repository<OutboxEventEntity>>(
    getRepositoryToken(OutboxEventEntity),
  );

  // ---- Seed config ----
  const orgName = process.env.SEED_ORG_NAME ?? 'Default Org';
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@local.test';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe123!';

  const customerPhone = process.env.SEED_CUSTOMER_PHONE ?? '01711111111';

  // ---- 1) Org ----
  let org = await orgRepo.findOne({ where: { name: orgName } });
  if (!org) {
    org = await orgRepo.save({
      name: orgName,
      plan: 'FREE',
    } as DeepPartial<OrganizationEntity>);
  }

  // ---- 2) Owner user ----
  let owner = await userRepo.findOne({ where: { orgId: org.id, email } });
  if (!owner) {
    const passwordHash = await bcrypt.hash(password, 12);
    owner = await userRepo.save({
      orgId: org.id,
      email,
      passwordHash,
      role: UserRole.OWNER,
      isActive: true,
    } as DeepPartial<UserEntity>);
  }

  // ---- 3) Channel ----
  // Find by org + type + name (safe, since those exist)
  let channel = await channelRepo.findOne({
    where: { orgId: org.id, type: ChannelType.FACEBOOK } as any,
  });

  if (!channel) {
    channel = await channelRepo.save({
      orgId: org.id,
      type: ChannelType.FACEBOOK,
      status: 'ACTIVE',
      pageId: 'PAGE_12345',
      externalAccountId: 'PAGE_12345',
    } as unknown as DeepPartial<ChannelEntity>);
  } else {
    await channelRepo.update(
      { id: channel.id } as any,
      {
        status: 'ACTIVE',
        pageId: 'PAGE_12345',
        externalAccountId: 'PAGE_12345',
      } as any,
    );
  }

  // ---- 4) Customer ----
  let customer = await customerRepo.findOne({
    where: { orgId: org.id, phone: customerPhone } as any,
  });

  if (!customer) {
    customer = await customerRepo.save({
      orgId: org.id,
      name: 'Customer One',
      phone: customerPhone,
    } as unknown as DeepPartial<CustomerEntity>);
  }

  // ---- 5) Conversation ----
  // Use stable key: channel + externalThreadId.
  // If your ConversationEntity requires externalThreadId, this will work.
  // If your ConversationEntity uses a different required field name, tell me and I’ll adjust.
  const externalThreadId = 'seed_thread_1';

  let convo = await convoRepo.findOne({
    where: { orgId: org.id, channelId: channel.id, externalThreadId } as any,
  });

  if (!convo) {
    convo = await convoRepo.save({
      orgId: org.id,
      channelId: channel.id,
      externalThreadId,
      externalUserId: 'seed_user_1',
      lastMessageAt: new Date(),
    } as unknown as DeepPartial<ConversationEntity>);
  }

  // ---- 6) Messages ----
  const msgExists = await msgRepo.findOne({
    where: { orgId: org.id, conversationId: convo.id } as any,
  });

  if (!msgExists) {
    await msgRepo.save([
      {
        orgId: org.id,
        conversationId: convo.id,
        direction: MessageDirection.IN,
        messageType: 'TEXT',
        text: 'Hi, is this available?',
        externalMessageId: 'seed_mid_1',
        occurredAt: new Date(Date.now() - 60_000),
      } as unknown as DeepPartial<MessageEntity>,
      {
        orgId: org.id,
        conversationId: convo.id,
        direction: MessageDirection.OUT,
        messageType: 'TEXT',
        text: 'Yes! Want to order now?',
        externalMessageId: 'seed_mid_2',
        occurredAt: new Date(Date.now() - 30_000),
      } as unknown as DeepPartial<MessageEntity>,
    ]);

    await convoRepo.update(
      { id: convo.id } as any,
      { lastMessageAt: new Date() } as any,
    );
  }

  // ---- 7) Order + timeline ----
  let order = await orderRepo.findOne({
    where: { orgId: org.id, conversationId: convo.id } as any,
  });

  if (!order) {
    const subtotal = 1000;
    const deliveryFee = 80;
    const total = subtotal + deliveryFee;

    order = await orderRepo.save({
      orgId: org.id,
      customerId: customer.id,
      conversationId: convo.id,
      status: OrderStatus.NEW,
      subtotal,
      deliveryFee,
      total,
      currency: 'BDT',
      notes: 'Seed order',
      paidAmount: 0,
      balanceDue: total,
      paymentStatus: 'UNPAID',
    } as unknown as DeepPartial<OrderEntity>);

    await orderEventRepo.save({
      orgId: org.id,
      orderId: order.id,
      type: 'ORDER_CREATED',
      data: { seeded: true },
    } as unknown as DeepPartial<OrderEventEntity>);
  }

  // ---- 8) Payment link + outbox event ----
  let payLink = await payLinkRepo.findOne({
    where: { orgId: org.id, orderId: order.id, provider: 'sslcommerz' } as any,
  });

  if (!payLink) {
    payLink = await payLinkRepo.save({
      orgId: org.id,
      orderId: order.id,
      provider: 'sslcommerz',
      amount: 500,
      status: 'CREATED',
    } as unknown as DeepPartial<PaymentLinkEntity>);

    await orderEventRepo.save({
      orgId: org.id,
      orderId: order.id,
      type: 'PAYMENT_LINK_CREATED',
      data: { paymentLinkId: payLink.id, amount: payLink.amount, seeded: true },
    } as unknown as DeepPartial<OrderEventEntity>);

    await outboxRepo.save({
      orgId: org.id,
      type: 'payment_link.generate',
      payload: { paymentLinkId: payLink.id },
      status: OutboxStatus.PENDING,
      attempts: 0,
      availableAt: new Date(),
    } as unknown as DeepPartial<OutboxEventEntity>);

    await payEventRepo.save({
      orgId: org.id,
      paymentLinkId: payLink.id,
      type: 'PAYMENT_LINK_QUEUED',
      payload: { seeded: true },
    } as unknown as DeepPartial<PaymentEventEntity>);
  }

  // ---- 9) Shipment + outbox event ----
  let shipment = await shipmentRepo.findOne({
    where: { orgId: org.id, orderId: order.id } as any,
  });

  if (!shipment) {
    shipment = await shipmentRepo.save({
      orgId: org.id,
      orderId: order.id,
      courierProvider: 'steadfast',
      status: ShipmentStatus.CREATED,
    } as unknown as DeepPartial<ShipmentEntity>);

    await orderEventRepo.save({
      orgId: org.id,
      orderId: order.id,
      type: 'SHIPMENT_REQUESTED',
      data: {
        shipmentId: shipment.id,
        courierProvider: shipment.courierProvider,
        seeded: true,
      },
    } as unknown as DeepPartial<OrderEventEntity>);

    await shipmentEventRepo.save({
      orgId: org.id,
      shipmentId: shipment.id,
      type: 'SHIPMENT_CREATED',
      payload: { seeded: true },
    } as unknown as DeepPartial<ShipmentEventEntity>);

    await outboxRepo.save({
      orgId: org.id,
      type: 'shipment.book',
      payload: {
        shipmentId: shipment.id,
        courierProvider: shipment.courierProvider,
      },
      status: OutboxStatus.PENDING,
      attempts: 0,
      availableAt: new Date(),
    } as unknown as DeepPartial<OutboxEventEntity>);
  }

  await app.close();
  // eslint-disable-next-line no-console
  console.log('Seed complete.');
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
