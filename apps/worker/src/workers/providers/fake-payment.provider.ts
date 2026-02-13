import { Injectable } from '@nestjs/common';

@Injectable()
export class FakePaymentProvider {
  generatePaymentLink(params: { paymentLinkId: string; amount: number }) {
    // Simulate a gateway response
    return {
      providerRef: `FAKE-${params.paymentLinkId}`,
      url: `https://pay.local/${params.paymentLinkId}?amount=${params.amount}`,
    };
  }
}
