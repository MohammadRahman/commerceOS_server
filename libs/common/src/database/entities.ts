import { ChannelEntity } from '../../../../apps/api/src/modules/inbox/entities/channel.entity';
import { ConversationEntity } from '../../../../apps/api/src/modules/inbox/entities/conversation.entity';
import { CustomerIdentityEntity } from '../../../../apps/api/src/modules/inbox/entities/customer-identity.entity';
import { CustomerEntity } from '../../../../apps/api/src/modules/inbox/entities/customer.entity';
import { MessageEntity } from '../../../../apps/api/src/modules/inbox/entities/message.entity';
import { OrderEventEntity } from '../../../../apps/api/src/modules/orders/entities/order-event.entity';
import { OrderEntity } from '../../../../apps/api/src/modules/orders/entities/order.entity';
import { PaymentEventEntity } from '../../../../apps/api/src/modules/payments/entities/payment-event.entity';
import { PaymentLinkEntity } from '../../../../apps/api/src/modules/payments/entities/payment-link.entity';
import { ShipmentEventEntity } from '../../../../apps/api/src/modules/shipments/entities/shipment-event.entity';
import { ShipmentEntity } from '../../../../apps/api/src/modules/shipments/entities/shipment.entity';
import { OrganizationEntity } from '../../../../apps/api/src/modules/tenancy/entities/organization.entity';
import { UserSessionEntity } from '../../../../apps/api/src/modules/tenancy/entities/user-session.entity';
import { UserEntity } from '../../../../apps/api/src/modules/tenancy/entities/user.entity';
import { OrgPaymentProviderEntity } from '../../../../apps/api/src/modules/providers/entities/org-payment-provider.entity';
import { OrgCourierProviderEntity } from '../../../../apps/api/src/modules/providers/entities/org-courier-provider.entity';
import { PaymentProviderCatalogEntity } from '../../../../apps/api/src/modules/providers/entities/payment-provider-catalog.entity';
import { CourierProviderCatalogEntity } from '../../../../apps/api/src/modules/providers/entities/courier-provider-catalog.entity';
import { IdempotencyKeyEntity } from '../idempotency';
import { OutboxEventEntity } from '../outbox';
import { SubscriptionPaymentEntity } from 'apps/api/src/modules/subscriptions/entities/subscription-payment.entity';
import { AutoReplyRuleEntity } from 'apps/api/src/modules/comments/entities/auto-reply-rule.entity';
import { PostCommentEntity } from 'apps/api/src/modules/comments/entities/post-comment.entity';

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

  OrgPaymentProviderEntity,
  OrgCourierProviderEntity,
  PaymentProviderCatalogEntity,
  CourierProviderCatalogEntity,

  OutboxEventEntity,
  IdempotencyKeyEntity,
  PostCommentEntity,
  AutoReplyRuleEntity,
  SubscriptionPaymentEntity,
] as const;
// import { ChannelEntity } from 'apps/api/src/modules/inbox/entities/channel.entity';
// import { ConversationEntity } from 'apps/api/src/modules/inbox/entities/conversation.entity';
// import { CustomerIdentityEntity } from 'apps/api/src/modules/inbox/entities/customer-identity.entity';
// import { CustomerEntity } from 'apps/api/src/modules/inbox/entities/customer.entity';
// import { MessageEntity } from 'apps/api/src/modules/inbox/entities/message.entity';
// import { OrderEventEntity } from 'apps/api/src/modules/orders/entities/order-event.entity';
// import { OrderEntity } from 'apps/api/src/modules/orders/entities/order.entity';
// import { PaymentEventEntity } from 'apps/api/src/modules/payments/entities/payment-event.entity';
// import { PaymentLinkEntity } from 'apps/api/src/modules/payments/entities/payment-link.entity';
// import { ShipmentEventEntity } from 'apps/api/src/modules/shipments/entities/shipment-event.entity';
// import { ShipmentEntity } from 'apps/api/src/modules/shipments/entities/shipment.entity';
// import { OrganizationEntity } from 'apps/api/src/modules/tenancy/entities/organization.entity';
// import { UserSessionEntity } from 'apps/api/src/modules/tenancy/entities/user-session.entity';
// import { UserEntity } from 'apps/api/src/modules/tenancy/entities/user.entity';
// import { OrgPaymentProviderEntity } from 'apps/api/src/modules/providers/entities/org-payment-provider.entity';
// import { OrgCourierProviderEntity } from 'apps/api/src/modules/providers/entities/org-courier-provider.entity';
// import { PaymentProviderCatalogEntity } from 'apps/api/src/modules/providers/entities/payment-provider-catalog.entity';
// import { CourierProviderCatalogEntity } from 'apps/api/src/modules/providers/entities/courier-provider-catalog.entity';
// import { IdempotencyKeyEntity } from '../idempotency';
// import { OutboxEventEntity } from '../outbox';

// export const ALL_ENTITIES = [
//   OrganizationEntity,
//   UserEntity,
//   UserSessionEntity,

//   ChannelEntity,
//   CustomerEntity,
//   CustomerIdentityEntity,
//   ConversationEntity,
//   MessageEntity,

//   OrderEntity,
//   OrderEventEntity,

//   PaymentLinkEntity,
//   PaymentEventEntity,

//   ShipmentEntity,
//   ShipmentEventEntity,

//   OrgPaymentProviderEntity,
//   OrgCourierProviderEntity,
//   PaymentProviderCatalogEntity,
//   CourierProviderCatalogEntity,

//   OutboxEventEntity,
//   IdempotencyKeyEntity,
// ] as const;
