import { ChannelEntity } from 'apps/api/src/modules/inbox/entities/channel.entity';
import { ConversationEntity } from 'apps/api/src/modules/inbox/entities/conversation.entity';
import { CustomerIdentityEntity } from 'apps/api/src/modules/inbox/entities/customer-identity.entity';
import { CustomerEntity } from 'apps/api/src/modules/inbox/entities/customer.entity';
import { MessageEntity } from 'apps/api/src/modules/inbox/entities/message.entity';
import { OrderEventEntity } from 'apps/api/src/modules/orders/entities/order-event.entity';
import { OrderEntity } from 'apps/api/src/modules/orders/entities/order.entity';
import { PaymentEventEntity } from 'apps/api/src/modules/payments/entities/payment-event.entity';
import { PaymentLinkEntity } from 'apps/api/src/modules/payments/entities/payment-link.entity';
import { ShipmentEventEntity } from 'apps/api/src/modules/shipments/entities/shipment-event.entity';
import { ShipmentEntity } from 'apps/api/src/modules/shipments/entities/shipment.entity';
import { OrganizationEntity } from 'apps/api/src/modules/tenancy/entities/organization.entity';
import { UserSessionEntity } from 'apps/api/src/modules/tenancy/entities/user-session.entity';
import { UserEntity } from 'apps/api/src/modules/tenancy/entities/user.entity';
import { IdempotencyKeyEntity } from '../idempotency';
import { OutboxEventEntity } from '../outbox';

export const ALL_ENTITIES = [
  OrganizationEntity,
  UserEntity,
  UserSessionEntity,

  ChannelEntity,
  CustomerEntity,
  CustomerIdentityEntity,
  ConversationEntity,
  MessageEntity,

  OrderEntity,
  OrderEventEntity,

  PaymentLinkEntity,
  PaymentEventEntity,

  ShipmentEntity,
  ShipmentEventEntity,

  OutboxEventEntity,
  IdempotencyKeyEntity,
] as const;
