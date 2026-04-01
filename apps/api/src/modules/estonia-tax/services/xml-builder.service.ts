// apps/api/src/modules/estonia-tax/services/xml-builder.service.ts
// Generates EMTA-compliant XML for KMD (VAT return) and TSD (payroll return).
// The schemas follow the official EMTA XML format descriptions.

import { Injectable } from '@nestjs/common';
import {
  EstoniaTaxPeriod,
  EstoniaVatTransaction,
  EstoniaEmployeeTaxRecord,
} from '../entities/estonia-tax.entities';

interface KmdXmlOptions {
  period: EstoniaTaxPeriod;
  vatTransactions: EstoniaVatTransaction[];
  kmdInfPartners: Array<{
    vatNumber: string;
    name: string;
    totalNet: number;
    totalVat: number;
  }>;
  organizationVatNumber: string;
  organizationName: string;
}

interface TsdXmlOptions {
  period: EstoniaTaxPeriod;
  employees: EstoniaEmployeeTaxRecord[];
  organizationRegCode: string;
  organizationName: string;
}

@Injectable()
export class EstoniaXmlBuilderService {
  // ─── KMD (VAT return) ─────────────────────────────────────────────────────
  // Builds the KMD form XML matching EMTA's schema.
  // Reference: https://www.emta.ee/en/business-client/taxes-and-payment/value-added-tax

  buildKmdXml(opts: KmdXmlOptions): string {
    const { period, kmdInfPartners, organizationVatNumber, organizationName } =
      opts;

    const periodStr = `${period.year}${String(period.month).padStart(2, '0')}`;

    // Aggregate sales by VAT rate for KMD rows
    const salesByRate = this.aggregateSalesByRate(opts.vatTransactions);

    const kmdInfRows = kmdInfPartners
      .map(
        (p) =>
          `    <INF_ROW>
      <PARTNER_VAT>${this.escXml(p.vatNumber)}</PARTNER_VAT>
      <PARTNER_NAME>${this.escXml(p.name)}</PARTNER_NAME>
      <NET_SALES>${this.fmt(p.totalNet)}</NET_SALES>
      <VAT_SALES>${this.fmt(p.totalVat)}</VAT_SALES>
    </INF_ROW>`,
      )
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<KMD xmlns="http://www.emta.ee/kmd">
  <HEADER>
    <FORM_TYPE>KMD</FORM_TYPE>
    <PERIOD>${periodStr}</PERIOD>
    <VAT_NUMBER>${this.escXml(organizationVatNumber)}</VAT_NUMBER>
    <COMPANY_NAME>${this.escXml(organizationName)}</COMPANY_NAME>
    <SUBMISSION_DATE>${new Date().toISOString().split('T')[0]}</SUBMISSION_DATE>
  </HEADER>
  <SUMMARY>
    <!-- Row 1: Taxable supply at standard rate 24% -->
    <ROW_1_TAXABLE_SUPPLY>${this.fmt(salesByRate[24]?.net ?? 0)}</ROW_1_TAXABLE_SUPPLY>
    <ROW_1_VAT>${this.fmt(salesByRate[24]?.vat ?? 0)}</ROW_1_VAT>
    <!-- Row 2: Taxable supply at 13% (accommodation) -->
    <ROW_2_TAXABLE_SUPPLY>${this.fmt(salesByRate[13]?.net ?? 0)}</ROW_2_TAXABLE_SUPPLY>
    <ROW_2_VAT>${this.fmt(salesByRate[13]?.vat ?? 0)}</ROW_2_VAT>
    <!-- Row 3: Taxable supply at 9% (press/books) -->
    <ROW_3_TAXABLE_SUPPLY>${this.fmt(salesByRate[9]?.net ?? 0)}</ROW_3_TAXABLE_SUPPLY>
    <ROW_3_VAT>${this.fmt(salesByRate[9]?.vat ?? 0)}</ROW_3_VAT>
    <!-- Row 4: Zero-rated supply (exports, intra-EU) -->
    <ROW_4_ZERO_RATED>${this.fmt(salesByRate[0]?.net ?? 0)}</ROW_4_ZERO_RATED>
    <!-- Row 5: Total taxable supply -->
    <ROW_5_TOTAL_TAXABLE>${this.fmt(period.kmdTaxableSales)}</ROW_5_TOTAL_TAXABLE>
    <!-- Row 6: Total output VAT -->
    <ROW_6_OUTPUT_VAT>${this.fmt(period.kmdOutputVat)}</ROW_6_OUTPUT_VAT>
    <!-- Row 7: Input VAT on purchases -->
    <ROW_7_INPUT_VAT>${this.fmt(period.kmdInputVat)}</ROW_7_INPUT_VAT>
    <!-- Row 8: VAT payable / refundable -->
    <ROW_8_VAT_PAYABLE>${this.fmt(period.kmdVatPayable)}</ROW_8_VAT_PAYABLE>
  </SUMMARY>
  <KMD_INF>
${kmdInfRows}
  </KMD_INF>
</KMD>`;
  }

  // ─── TSD (payroll return) ─────────────────────────────────────────────────
  // Builds the TSD main form + Annex 1 (resident employees) XML.
  // Reference: https://www.emta.ee/en/business-client/taxes-and-payment/income-and-social-taxes/form-tsd

  buildTsdXml(opts: TsdXmlOptions): string {
    const { period, employees, organizationRegCode, organizationName } = opts;

    const periodStr = `${period.year}${String(period.month).padStart(2, '0')}`;

    const annex1Rows = employees
      .map(
        (emp, i) =>
          `    <ANNEX1_ROW>
      <ROW_NR>${i + 1}</ROW_NR>
      <RECIPIENT_ID_CODE>${this.escXml(emp.employeeIdCode)}</RECIPIENT_ID_CODE>
      <RECIPIENT_NAME>${this.escXml(emp.employeeName)}</RECIPIENT_NAME>
      <PAYMENT_TYPE>${emp.paymentTypeCode}</PAYMENT_TYPE>
      <GROSS_AMOUNT>${this.fmt(emp.grossSalary)}</GROSS_AMOUNT>
      <BASIC_EXEMPTION_APPLIED>${this.fmt(emp.basicExemption)}</BASIC_EXEMPTION_APPLIED>
      <INCOME_TAX_WITHHELD>${this.fmt(emp.incomeTaxWithheld)}</INCOME_TAX_WITHHELD>
      <SOCIAL_TAX>${this.fmt(emp.socialTaxEmployer)}</SOCIAL_TAX>
      <UNEMPLOYMENT_INS_EMPLOYER>${this.fmt(emp.unemploymentEmployer)}</UNEMPLOYMENT_INS_EMPLOYER>
      <UNEMPLOYMENT_INS_EMPLOYEE>${this.fmt(emp.unemploymentEmployee)}</UNEMPLOYMENT_INS_EMPLOYEE>
      <FUNDED_PENSION_II>${this.fmt(emp.fundedPensionII)}</FUNDED_PENSION_II>
    </ANNEX1_ROW>`,
      )
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<TSD xmlns="http://www.emta.ee/tsd">
  <HEADER>
    <FORM_TYPE>TSD</FORM_TYPE>
    <PERIOD>${periodStr}</PERIOD>
    <REG_CODE>${this.escXml(organizationRegCode)}</REG_CODE>
    <COMPANY_NAME>${this.escXml(organizationName)}</COMPANY_NAME>
    <SUBMISSION_DATE>${new Date().toISOString().split('T')[0]}</SUBMISSION_DATE>
  </HEADER>
  <SUMMARY>
    <TOTAL_GROSS_SALARY>${this.fmt(period.tsdGrossSalary)}</TOTAL_GROSS_SALARY>
    <TOTAL_INCOME_TAX>${this.fmt(period.tsdIncomeTaxWithheld)}</TOTAL_INCOME_TAX>
    <TOTAL_SOCIAL_TAX>${this.fmt(period.tsdSocialTax)}</TOTAL_SOCIAL_TAX>
    <TOTAL_UNEMPLOYMENT_EMPLOYER>${this.fmt(period.tsdUnemploymentEmployer)}</TOTAL_UNEMPLOYMENT_EMPLOYER>
    <TOTAL_UNEMPLOYMENT_EMPLOYEE>${this.fmt(period.tsdUnemploymentEmployee)}</TOTAL_UNEMPLOYMENT_EMPLOYEE>
    <TOTAL_FUNDED_PENSION_II>${this.fmt(period.tsdFundedPensionII)}</TOTAL_FUNDED_PENSION_II>
  </SUMMARY>
  <ANNEX1>
${annex1Rows}
  </ANNEX1>
</TSD>`;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private aggregateSalesByRate(
    transactions: EstoniaVatTransaction[],
  ): Record<number, { net: number; vat: number }> {
    const result: Record<number, { net: number; vat: number }> = {};

    for (const tx of transactions) {
      const rate = parseFloat(tx.vatRate.toString());
      if (!result[rate]) result[rate] = { net: 0, vat: 0 };
      result[rate].net += parseFloat(tx.netAmount.toString());
      result[rate].vat += parseFloat(tx.vatAmount.toString());
    }

    // Round totals
    for (const rate of Object.keys(result)) {
      result[Number(rate)].net = parseFloat(
        result[Number(rate)].net.toFixed(2),
      );
      result[Number(rate)].vat = parseFloat(
        result[Number(rate)].vat.toFixed(2),
      );
    }

    return result;
  }

  private fmt(value: number): string {
    return parseFloat(value?.toString() ?? '0').toFixed(2);
  }

  private escXml(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
