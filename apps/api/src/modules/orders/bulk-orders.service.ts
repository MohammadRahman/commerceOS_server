/* eslint-disable @typescript-eslint/no-unused-vars */
// v2
// apps/api/src/modules/orders/bulk-orders.service.ts — v2
// Payment gates applied — matches single-order logic exactly

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderEntity, OrderStatus } from './entities/order.entity';
import { OrderEventEntity } from './entities/order-event.entity';
import { BulkResult } from './dto/bulk-order.dto';

@Injectable()
export class BulkOrdersService {
  private readonly logger = new Logger(BulkOrdersService.name);

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(OrderEventEntity)
    private readonly events: Repository<OrderEventEntity>,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildResult<T>(
    succeeded: { orderId: string; result: T }[],
    failed: { orderId: string; reason: string }[],
  ): BulkResult<T> {
    return {
      total: succeeded.length + failed.length,
      successCount: succeeded.length,
      failureCount: failed.length,
      succeeded,
      failed,
    };
  }

  private async loadOrders(
    orgId: string,
    orderIds: string[],
  ): Promise<{ found: Map<string, OrderEntity>; missing: string[] }> {
    const found = await this.orders.find({
      where: orderIds.map((id) => ({ id, orgId })),
      relations: ['customer'],
    });
    const foundMap = new Map(found.map((o) => [o.id, o]));
    const missing = orderIds.filter((id) => !foundMap.has(id));
    return { found: foundMap, missing };
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

  /**
   * Payment gate — same rules as single-order service.
   * Returns a rejection reason string, or null if allowed.
   */
  private paymentGateReason(
    order: OrderEntity,
    next: OrderStatus,
    force = false,
  ): string | null {
    const balanceDue = order.balanceDue ?? 0;
    const total = order.total ?? 0;

    if (next === OrderStatus.DISPATCHED) {
      if (balanceDue === total && total > 0 && !force) {
        return `Full amount ${total} BDT still due — use force flag for COD-only orders`;
      }
    }

    if (next === OrderStatus.DELIVERED) {
      if (balanceDue > 0 && !force) {
        return `${balanceDue} BDT balance due — collect COD or use force flag`;
      }
    }

    return null;
  }

  // ─── Bulk Confirm ─────────────────────────────────────────────────────────

  async bulkConfirm(
    orgId: string,
    userId: string,
    orderIds: string[],
  ): Promise<BulkResult> {
    const { found, missing } = await this.loadOrders(orgId, orderIds);

    const succeeded: BulkResult['succeeded'] = [];
    const failed: BulkResult['failed'] = missing.map((id) => ({
      orderId: id,
      reason: 'Order not found',
    }));

    await Promise.allSettled(
      Array.from(found.values()).map(async (order) => {
        try {
          if (!this.isAllowedTransition(order.status, OrderStatus.CONFIRMED)) {
            failed.push({
              orderId: order.id,
              reason: `Cannot confirm — status is ${order.status}`,
            });
            return;
          }
          await this.orders.update(
            { id: order.id, orgId },
            { status: OrderStatus.CONFIRMED },
          );
          await this.events.save(
            this.events.create({
              orgId,
              orderId: order.id,
              type: 'ORDER_STATUS_CHANGED',
              data: {
                userId,
                from: order.status,
                to: OrderStatus.CONFIRMED,
                bulk: true,
              },
            }),
          );
          succeeded.push({
            orderId: order.id,
            result: { status: OrderStatus.CONFIRMED },
          });
        } catch (err) {
          failed.push({
            orderId: order.id,
            reason: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }),
    );

    return this.buildResult(succeeded, failed);
  }

  // ─── Bulk Status Change ───────────────────────────────────────────────────

  async bulkChangeStatus(
    orgId: string,
    userId: string,
    orderIds: string[],
    nextStatus: OrderStatus,
    force = false,
  ): Promise<BulkResult> {
    const { found, missing } = await this.loadOrders(orgId, orderIds);

    const succeeded: BulkResult['succeeded'] = [];
    const failed: BulkResult['failed'] = missing.map((id) => ({
      orderId: id,
      reason: 'Order not found',
    }));

    const TERMINAL = new Set([
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
      OrderStatus.RETURNED,
      OrderStatus.FAILED_DELIVERY,
    ]);

    await Promise.allSettled(
      Array.from(found.values()).map(async (order) => {
        try {
          if (!this.isAllowedTransition(order.status, nextStatus)) {
            failed.push({
              orderId: order.id,
              reason: `Invalid transition ${order.status} → ${nextStatus}`,
            });
            return;
          }

          // ✅ Apply payment gate
          const gateReason = this.paymentGateReason(order, nextStatus, force);
          if (gateReason) {
            failed.push({ orderId: order.id, reason: gateReason });
            return;
          }

          await this.orders.update(
            { id: order.id, orgId },
            { status: nextStatus },
          );
          await this.events.save(
            this.events.create({
              orgId,
              orderId: order.id,
              type: 'ORDER_STATUS_CHANGED',
              data: {
                userId,
                from: order.status,
                to: nextStatus,
                bulk: true,
                forced: force,
              },
            }),
          );
          succeeded.push({ orderId: order.id, result: { status: nextStatus } });
        } catch (err) {
          failed.push({
            orderId: order.id,
            reason: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }),
    );

    return this.buildResult(succeeded, failed);
  }

  // ─── Bulk Payment Link ────────────────────────────────────────────────────

  async bulkCreatePaymentLinks(
    orgId: string,
    userId: string,
    orderIds: string[],
    provider: string,
    deliveryFee?: number,
  ): Promise<BulkResult> {
    const { found, missing } = await this.loadOrders(orgId, orderIds);

    const succeeded: BulkResult['succeeded'] = [];
    const failed: BulkResult['failed'] = missing.map((id) => ({
      orderId: id,
      reason: 'Order not found',
    }));

    const TERMINAL = new Set([
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
      OrderStatus.RETURNED,
      OrderStatus.FAILED_DELIVERY,
    ]);

    for (const order of found.values()) {
      if (TERMINAL.has(order.status)) {
        failed.push({
          orderId: order.id,
          reason: `Order is ${order.status} — cannot generate payment link`,
        });
        continue;
      }
      if (order.paymentStatus === 'PAID') {
        failed.push({ orderId: order.id, reason: 'Already fully paid' });
        continue;
      }
      try {
        await this.events.save(
          this.events.create({
            orgId,
            orderId: order.id,
            type: 'BULK_PAYMENT_LINK_REQUESTED',
            data: {
              userId,
              provider,
              deliveryFee: deliveryFee ?? 0,
              bulk: true,
            },
          }),
        );
        succeeded.push({
          orderId: order.id,
          result: { provider, queued: true },
        });
      } catch (err) {
        failed.push({
          orderId: order.id,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return this.buildResult(succeeded, failed);
  }

  // ─── Bulk Courier Booking ─────────────────────────────────────────────────

  async bulkBookCourier(
    orgId: string,
    userId: string,
    orderIds: string[],
    provider: string,
    serviceType?: string,
  ): Promise<BulkResult> {
    const { found, missing } = await this.loadOrders(orgId, orderIds);

    const succeeded: BulkResult['succeeded'] = [];
    const failed: BulkResult['failed'] = missing.map((id) => ({
      orderId: id,
      reason: 'Order not found',
    }));

    for (const order of found.values()) {
      if (order.status !== OrderStatus.PACKED) {
        failed.push({
          orderId: order.id,
          reason: `Order must be PACKED to book courier — current status: ${order.status}`,
        });
        continue;
      }
      try {
        await this.events.save(
          this.events.create({
            orgId,
            orderId: order.id,
            type: 'BULK_COURIER_BOOKING_REQUESTED',
            data: {
              userId,
              provider,
              serviceType: serviceType ?? null,
              bulk: true,
            },
          }),
        );
        succeeded.push({
          orderId: order.id,
          result: { provider, queued: true },
        });
      } catch (err) {
        failed.push({
          orderId: order.id,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return this.buildResult(succeeded, failed);
  }

  // ─── Bulk Invoice Export ──────────────────────────────────────────────────

  async bulkGetInvoiceData(
    orgId: string,
    orderIds: string[],
  ): Promise<BulkResult> {
    const { found, missing } = await this.loadOrders(orgId, orderIds);

    const succeeded: BulkResult['succeeded'] = [];
    const failed: BulkResult['failed'] = missing.map((id) => ({
      orderId: id,
      reason: 'Order not found',
    }));

    for (const order of found.values()) {
      succeeded.push({
        orderId: order.id,
        result: {
          orderId: order.id,
          orderRef: order.id.slice(0, 8).toUpperCase(),
          status: order.status,
          createdAt: order.createdAt,
          customer: {
            name: order.customer?.name ?? null,
            phone: order.customer?.phone ?? null,
            email: order.customer?.email ?? null,
            addressText: order.customer?.addressText ?? null,
          },
          subtotal: order.subtotal,
          deliveryFee: order.deliveryFee,
          total: order.total,
          paidAmount: order.paidAmount,
          balanceDue: order.balanceDue,
          paymentStatus: order.paymentStatus,
          currency: order.currency,
          campaignTag: order.campaignTag ?? null,
          notes: order.notes ?? null,
        },
      });
    }

    return this.buildResult(succeeded, failed);
  }
}
// // apps/api/src/modules/orders/bulk-orders.service.ts
// import { Injectable, Logger } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { OrderEntity, OrderStatus } from './entities/order.entity';
// import { OrderEventEntity } from './entities/order-event.entity';
// import { BulkResult } from './dto/bulk-order.dto';

// @Injectable()
// export class BulkOrdersService {
//   private readonly logger = new Logger(BulkOrdersService.name);

//   constructor(
//     @InjectRepository(OrderEntity)
//     private readonly orders: Repository<OrderEntity>,
//     @InjectRepository(OrderEventEntity)
//     private readonly events: Repository<OrderEventEntity>,
//   ) {}

//   // ─── Helper: build result envelope ───────────────────────────────────────

//   private buildResult<T>(
//     succeeded: { orderId: string; result: T }[],
//     failed: { orderId: string; reason: string }[],
//   ): BulkResult<T> {
//     return {
//       total: succeeded.length + failed.length,
//       successCount: succeeded.length,
//       failureCount: failed.length,
//       succeeded,
//       failed,
//     };
//   }

//   // ─── Helper: verify all orderIds belong to this org ──────────────────────

//   private async loadOrders(
//     orgId: string,
//     orderIds: string[],
//   ): Promise<{ found: Map<string, OrderEntity>; missing: string[] }> {
//     const found = await this.orders.find({
//       where: orderIds.map((id) => ({ id, orgId })),
//       relations: ['customer'],
//     });
//     const foundMap = new Map(found.map((o) => [o.id, o]));
//     const missing = orderIds.filter((id) => !foundMap.has(id));
//     return { found: foundMap, missing };
//   }

//   // ─── Status transition map ────────────────────────────────────────────────

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

//   // ─── Bulk Confirm (NEW → CONFIRMED) ──────────────────────────────────────

//   async bulkConfirm(
//     orgId: string,
//     userId: string,
//     orderIds: string[],
//   ): Promise<BulkResult> {
//     const { found, missing } = await this.loadOrders(orgId, orderIds);

//     const succeeded: BulkResult['succeeded'] = [];
//     const failed: BulkResult['failed'] = missing.map((id) => ({
//       orderId: id,
//       reason: 'Order not found',
//     }));

//     await Promise.allSettled(
//       Array.from(found.values()).map(async (order) => {
//         try {
//           if (!this.isAllowedTransition(order.status, OrderStatus.CONFIRMED)) {
//             failed.push({
//               orderId: order.id,
//               reason: `Cannot confirm order in status ${order.status}`,
//             });
//             return;
//           }
//           await this.orders.update(
//             { id: order.id, orgId },
//             { status: OrderStatus.CONFIRMED },
//           );
//           await this.events.save(
//             this.events.create({
//               orgId,
//               orderId: order.id,
//               type: 'ORDER_STATUS_CHANGED',
//               data: {
//                 userId,
//                 from: order.status,
//                 to: OrderStatus.CONFIRMED,
//                 bulk: true,
//               },
//             }),
//           );
//           succeeded.push({
//             orderId: order.id,
//             result: { status: OrderStatus.CONFIRMED },
//           });
//         } catch (err) {
//           const msg = err instanceof Error ? err.message : 'Unknown error';
//           this.logger.error(`[BulkConfirm] orderId=${order.id} failed: ${msg}`);
//           failed.push({ orderId: order.id, reason: msg });
//         }
//       }),
//     );

//     return this.buildResult(succeeded, failed);
//   }

//   // ─── Bulk Status Change ───────────────────────────────────────────────────

//   async bulkChangeStatus(
//     orgId: string,
//     userId: string,
//     orderIds: string[],
//     nextStatus: OrderStatus,
//   ): Promise<BulkResult> {
//     const { found, missing } = await this.loadOrders(orgId, orderIds);

//     const succeeded: BulkResult['succeeded'] = [];
//     const failed: BulkResult['failed'] = missing.map((id) => ({
//       orderId: id,
//       reason: 'Order not found',
//     }));

//     await Promise.allSettled(
//       Array.from(found.values()).map(async (order) => {
//         try {
//           if (!this.isAllowedTransition(order.status, nextStatus)) {
//             failed.push({
//               orderId: order.id,
//               reason: `Invalid transition ${order.status} → ${nextStatus}`,
//             });
//             return;
//           }
//           await this.orders.update(
//             { id: order.id, orgId },
//             { status: nextStatus },
//           );
//           await this.events.save(
//             this.events.create({
//               orgId,
//               orderId: order.id,
//               type: 'ORDER_STATUS_CHANGED',
//               data: { userId, from: order.status, to: nextStatus, bulk: true },
//             }),
//           );
//           succeeded.push({ orderId: order.id, result: { status: nextStatus } });
//         } catch (err) {
//           const msg = err instanceof Error ? err.message : 'Unknown error';
//           this.logger.error(`[BulkStatus] orderId=${order.id} failed: ${msg}`);
//           failed.push({ orderId: order.id, reason: msg });
//         }
//       }),
//     );

//     return this.buildResult(succeeded, failed);
//   }

//   // ─── Bulk Payment Link ────────────────────────────────────────────────────
//   // Creates a payment link record per order.
//   // Delegates to the payment-links service via HTTP or direct injection.
//   // For now, returns a stub — wire to PaymentLinksService when ready.

//   async bulkCreatePaymentLinks(
//     orgId: string,
//     userId: string,
//     orderIds: string[],
//     provider: string,
//     deliveryFee?: number,
//   ): Promise<BulkResult> {
//     const { found, missing } = await this.loadOrders(orgId, orderIds);

//     const succeeded: BulkResult['succeeded'] = [];
//     const failed: BulkResult['failed'] = missing.map((id) => ({
//       orderId: id,
//       reason: 'Order not found',
//     }));

//     const TERMINAL = new Set([
//       OrderStatus.DELIVERED,
//       OrderStatus.CANCELLED,
//       OrderStatus.RETURNED,
//       OrderStatus.FAILED_DELIVERY,
//     ]);

//     for (const order of found.values()) {
//       if (TERMINAL.has(order.status)) {
//         failed.push({
//           orderId: order.id,
//           reason: `Order is ${order.status} — cannot generate payment link`,
//         });
//         continue;
//       }
//       if (order.paymentStatus === 'PAID') {
//         failed.push({
//           orderId: order.id,
//           reason: 'Order is already fully paid',
//         });
//         continue;
//       }
//       // TODO: inject PaymentLinksService and call createPaymentLink(...)
//       // For now, record the intent as an event so the audit trail is maintained
//       try {
//         await this.events.save(
//           this.events.create({
//             orgId,
//             orderId: order.id,
//             type: 'BULK_PAYMENT_LINK_REQUESTED',
//             data: {
//               userId,
//               provider,
//               deliveryFee: deliveryFee ?? 0,
//               bulk: true,
//             },
//           }),
//         );
//         succeeded.push({
//           orderId: order.id,
//           result: { provider, queued: true },
//         });
//       } catch (err) {
//         const msg = err instanceof Error ? err.message : 'Unknown error';
//         failed.push({ orderId: order.id, reason: msg });
//       }
//     }

//     return this.buildResult(succeeded, failed);
//   }

//   // ─── Bulk Courier Booking ─────────────────────────────────────────────────
//   // Validates orders are PACKED, then queues booking.
//   // Wire to CourierService when ready.

//   async bulkBookCourier(
//     orgId: string,
//     userId: string,
//     orderIds: string[],
//     provider: string,
//     serviceType?: string,
//   ): Promise<BulkResult> {
//     const { found, missing } = await this.loadOrders(orgId, orderIds);

//     const succeeded: BulkResult['succeeded'] = [];
//     const failed: BulkResult['failed'] = missing.map((id) => ({
//       orderId: id,
//       reason: 'Order not found',
//     }));

//     for (const order of found.values()) {
//       if (order.status !== OrderStatus.PACKED) {
//         failed.push({
//           orderId: order.id,
//           reason: `Order must be PACKED to book courier — current status: ${order.status}`,
//         });
//         continue;
//       }
//       try {
//         // TODO: inject CourierService and call bookShipment(...)
//         await this.events.save(
//           this.events.create({
//             orgId,
//             orderId: order.id,
//             type: 'BULK_COURIER_BOOKING_REQUESTED',
//             data: {
//               userId,
//               provider,
//               serviceType: serviceType ?? null,
//               bulk: true,
//             },
//           }),
//         );
//         succeeded.push({
//           orderId: order.id,
//           result: { provider, queued: true },
//         });
//       } catch (err) {
//         const msg = err instanceof Error ? err.message : 'Unknown error';
//         failed.push({ orderId: order.id, reason: msg });
//       }
//     }

//     return this.buildResult(succeeded, failed);
//   }

//   // ─── Bulk Invoice Export ──────────────────────────────────────────────────
//   // Returns structured invoice data per order.
//   // Frontend renders to PDF using react-pdf or similar.

//   async bulkGetInvoiceData(
//     orgId: string,
//     orderIds: string[],
//   ): Promise<BulkResult> {
//     const { found, missing } = await this.loadOrders(orgId, orderIds);

//     const succeeded: BulkResult['succeeded'] = [];
//     const failed: BulkResult['failed'] = missing.map((id) => ({
//       orderId: id,
//       reason: 'Order not found',
//     }));

//     for (const order of found.values()) {
//       succeeded.push({
//         orderId: order.id,
//         result: {
//           orderId: order.id,
//           orderRef: order.id.slice(0, 8).toUpperCase(),
//           status: order.status,
//           createdAt: order.createdAt,
//           customer: {
//             name: order.customer?.name ?? null,
//             phone: order.customer?.phone ?? null,
//             email: order.customer?.email ?? null,
//             addressText: order.customer?.addressText ?? null,
//           },
//           subtotal: order.subtotal,
//           deliveryFee: order.deliveryFee,
//           total: order.total,
//           paidAmount: order.paidAmount,
//           balanceDue: order.balanceDue,
//           paymentStatus: order.paymentStatus,
//           currency: order.currency,
//           campaignTag: order.campaignTag ?? null,
//           notes: order.notes ?? null,
//         },
//       });
//     }

//     return this.buildResult(succeeded, failed);
//   }
// }
