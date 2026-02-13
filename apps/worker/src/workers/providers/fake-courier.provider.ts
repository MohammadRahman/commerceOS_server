import { Injectable } from '@nestjs/common';

@Injectable()
export class FakeCourierProvider {
  bookShipment(params: { shipmentId: string; courierProvider: string }) {
    const consignmentId = `CN-${params.shipmentId.slice(0, 8)}`;
    return {
      consignmentId,
      trackingUrl: `https://track.local/${consignmentId}`,
    };
  }
}
