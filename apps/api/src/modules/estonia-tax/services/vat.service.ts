// apps/api/src/modules/estonia-tax/services/vat.service.ts
// Handles VAT rate selection, transaction recording, and KMD/KMD INF aggregation.

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import {
  EstoniaVatTransaction,
  VatTransactionType,
  EstoniaTaxPeriod,
  TaxPeriodStatus,
} from '../entities/estonia-tax.entities';
import {
  ESTONIA_VAT_RATES,
  ESTONIA_VAT_REGISTRATION_THRESHOLD_EUR,
  EstoniaVatRate,
} from '../estonia-tax.constants';
import { RecordVatTransactionDto } from '../dto/estonia-tax.dto';

interface VatRateLookup {
  rate: EstoniaVatRate;
  description: string;
}

@Injectable()
export class EstoniaVatService {
  private readonly logger = new Logger(EstoniaVatService.name);

  constructor(
    @InjectRepository(EstoniaVatTransaction)
    private readonly vatTxRepo: Repository<EstoniaVatTransaction>,

    @InjectRepository(EstoniaTaxPeriod)
    private readonly periodRepo: Repository<EstoniaTaxPeriod>,
  ) {}

  // ─── Rate engine ──────────────────────────────────────────────────────────
  // Determines the correct Estonian VAT rate for a given supply type.
  // Kept explicit so every rate decision is auditable and testable.

  getApplicableRate(
    transactionType: VatTransactionType,
    category?: string,
  ): VatRateLookup {
    switch (transactionType) {
      case VatTransactionType.EXPORT:
      case VatTransactionType.INTRA_EU_SUPPLY:
        return {
          rate: ESTONIA_VAT_RATES.ZERO,
          description: 'Zero-rated — export / intra-EU',
        };

      case VatTransactionType.REVERSE_CHARGE:
        return {
          rate: ESTONIA_VAT_RATES.ZERO,
          description: 'Reverse charge — buyer accounts for VAT',
        };

      case VatTransactionType.SALE:
      case VatTransactionType.PURCHASE:
      case VatTransactionType.INTRA_EU_ACQUISITION:
      case VatTransactionType.IMPORT: {
        // Category-based reduced rates
        if (category === 'accommodation') {
          return {
            rate: ESTONIA_VAT_RATES.ACCOMMODATION,
            description: '13% — accommodation services',
          };
        }
        if (category === 'press' || category === 'books') {
          return {
            rate: ESTONIA_VAT_RATES.REDUCED,
            description: '9% — press/books',
          };
        }
        return {
          rate: ESTONIA_VAT_RATES.STANDARD,
          description: '24% — standard rate',
        };
      }

      default:
        return {
          rate: ESTONIA_VAT_RATES.STANDARD,
          description: '24% — standard rate (default)',
        };
    }
  }

  calculateVatAmounts(netAmount: number, vatRate: EstoniaVatRate) {
    const vatAmount = parseFloat(((netAmount * vatRate) / 100).toFixed(2));
    const grossAmount = parseFloat((netAmount + vatAmount).toFixed(2));
    return { netAmount, vatAmount, grossAmount, vatRate };
  }

  // ─── Record transaction ───────────────────────────────────────────────────

  async recordTransaction(
    orgId: string,
    dto: RecordVatTransactionDto,
  ): Promise<EstoniaVatTransaction> {
    // Validate VAT rate is a known Estonian rate
    const validRates = Object.values(ESTONIA_VAT_RATES) as number[];
    if (!validRates.includes(Number(dto.vatRate))) {
      throw new BadRequestException(
        `VAT rate ${dto.vatRate}% is not a valid Estonian VAT rate. Valid rates: ${validRates.join(', ')}%`,
      );
    }

    const tx = this.vatTxRepo.create({
      orgId,
      taxYear: dto.taxYear,
      taxMonth: dto.taxMonth,
      transactionType: dto.transactionType,
      vatRate: dto.vatRate,
      netAmount: dto.netAmount,
      vatAmount: dto.vatAmount,
      grossAmount: dto.grossAmount,
      transactionDate: new Date(dto.transactionDate),
      invoiceNumber: dto.invoiceNumber,
      counterpartyVatNumber: dto.counterpartyVatNumber,
      counterpartyName: dto.counterpartyName,
      sourceOrderId: dto.sourceOrderId,
      sourcePaymentId: dto.sourcePaymentId,
    });

    const saved = await this.vatTxRepo.save(tx);

    // Recalculate period totals asynchronously
    this.recalculatePeriodTotals(orgId, dto.taxYear, dto.taxMonth).catch(
      (err) => this.logger.error('Period recalculation failed', err),
    );

    return saved;
  }

  // ─── Period aggregation ───────────────────────────────────────────────────
  // Called after each transaction save and before KMD generation.

  async recalculatePeriodTotals(
    orgId: string,
    year: number,
    month: number,
  ): Promise<EstoniaTaxPeriod> {
    let period = await this.periodRepo.findOne({
      where: { orgId, year, month },
    });
    if (!period) {
      period = this.periodRepo.create({
        orgId,
        year,
        month,
        kmdStatus: TaxPeriodStatus.PENDING,
        tsdStatus: TaxPeriodStatus.PENDING,
      });
    }

    const transactions = await this.vatTxRepo.find({
      where: { orgId, taxYear: year, taxMonth: month },
    });

    let outputVat = 0;
    let inputVat = 0;
    let taxableSales = 0;

    for (const tx of transactions) {
      const net = parseFloat(tx.netAmount.toString());
      const vat = parseFloat(tx.vatAmount.toString());

      if (
        tx.transactionType === VatTransactionType.SALE ||
        tx.transactionType === VatTransactionType.INTRA_EU_SUPPLY ||
        tx.transactionType === VatTransactionType.EXPORT
      ) {
        outputVat += vat;
        taxableSales += net;
      } else if (
        tx.transactionType === VatTransactionType.PURCHASE ||
        tx.transactionType === VatTransactionType.INTRA_EU_ACQUISITION ||
        tx.transactionType === VatTransactionType.IMPORT
      ) {
        inputVat += vat;
      }
    }

    period.kmdTaxableSales = parseFloat(taxableSales.toFixed(2));
    period.kmdOutputVat = parseFloat(outputVat.toFixed(2));
    period.kmdInputVat = parseFloat(inputVat.toFixed(2));
    period.kmdVatPayable = parseFloat((outputVat - inputVat).toFixed(2));

    if (
      transactions.length > 0 &&
      period.kmdStatus === TaxPeriodStatus.PENDING
    ) {
      period.kmdStatus = TaxPeriodStatus.READY;
    }

    return this.periodRepo.save(period);
  }

  // ─── KMD INF partner list ─────────────────────────────────────────────────
  // EMTA requires listing all B2B transactions > €1 000 with Estonian companies.
  // Returns grouped totals per counterparty VAT number.

  async getKmdInfPartners(
    orgId: string,
    year: number,
    month: number,
  ): Promise<
    Array<{
      vatNumber: string;
      name: string;
      totalNet: number;
      totalVat: number;
    }>
  > {
    const rawTx = await this.vatTxRepo.find({
      where: {
        orgId,
        taxYear: year,
        taxMonth: month,
        transactionType: VatTransactionType.SALE,
      },
    });

    const grouped = new Map<
      string,
      { name: string; totalNet: number; totalVat: number }
    >();

    for (const tx of rawTx) {
      if (!tx.counterpartyVatNumber) continue;
      const net = parseFloat(tx.netAmount.toString());
      const vat = parseFloat(tx.vatAmount.toString());

      if (!grouped.has(tx.counterpartyVatNumber)) {
        grouped.set(tx.counterpartyVatNumber, {
          name: tx.counterpartyName || '',
          totalNet: 0,
          totalVat: 0,
        });
      }
      const entry = grouped.get(tx.counterpartyVatNumber)!;
      entry.totalNet += net;
      entry.totalVat += vat;
    }

    // Filter: only include partners where total exceeds €1 000
    return Array.from(grouped.entries())
      .filter(([, v]) => v.totalNet >= 1000)
      .map(([vatNumber, v]) => ({ vatNumber, ...v }));
  }

  // ─── Annual turnover check ────────────────────────────────────────────────
  // Returns YTD turnover so the UI can warn when approaching the €40k threshold.

  async getAnnualTurnover(orgId: string, year: number): Promise<number> {
    const transactions = await this.vatTxRepo.find({
      where: { orgId, taxYear: year },
    });

    return transactions
      .filter((t) =>
        [
          VatTransactionType.SALE,
          VatTransactionType.EXPORT,
          VatTransactionType.INTRA_EU_SUPPLY,
        ].includes(t.transactionType),
      )
      .reduce((sum, t) => sum + parseFloat(t.netAmount.toString()), 0);
  }

  async isApproachingVatThreshold(
    orgId: string,
    year: number,
  ): Promise<boolean> {
    const turnover = await this.getAnnualTurnover(orgId, year);
    // Warn at 80% of threshold
    return turnover >= ESTONIA_VAT_REGISTRATION_THRESHOLD_EUR * 0.8;
  }
}
