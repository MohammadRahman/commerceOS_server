import { Controller, Get, Query } from '@nestjs/common';
import { ProvidersCatalogService } from '../services/providers-catalog.service';

@Controller('v1/catalog')
export class ProvidersCatalogController {
  constructor(private catalog: ProvidersCatalogService) {}

  // GET /v1/catalog/payment-providers?country=BD
  @Get('payment-providers')
  listPayments(@Query('country') country?: string) {
    return this.catalog.listPayments(country);
  }

  // GET /v1/catalog/courier-providers?country=BD
  @Get('courier-providers')
  listCouriers(@Query('country') country?: string) {
    return this.catalog.listCouriers(country);
  }
}
