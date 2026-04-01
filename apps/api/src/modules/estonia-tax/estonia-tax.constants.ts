// apps/api/src/modules/estonia-tax/estonia-tax.constants.ts
// All Estonian tax rates and deadlines in one place.
// Update here when EMTA changes rates — nowhere else.

export const ESTONIA_VAT_RATES = {
  STANDARD: 24, // From 1 July 2025 — most goods & services
  ACCOMMODATION: 13, // Hotels, B&Bs (increased from 9% on 1 Jan 2025)
  REDUCED: 9, // Press publications, books
  ZERO: 0, // Exports, intra-EU supply, international transport
} as const;

export type EstoniaVatRate =
  (typeof ESTONIA_VAT_RATES)[keyof typeof ESTONIA_VAT_RATES];

// CIT applies only on distribution; no tax on retained earnings
export const ESTONIA_CIT_RATE = 22; // % of gross distributed profit (22/78 of net)
export const ESTONIA_PERSONAL_INCOME_TAX_RATE = 22; // Flat rate from 2025
export const ESTONIA_SOCIAL_TAX_RATE = 33; // Employer pays on gross salary
export const ESTONIA_UNEMPLOYMENT_EMPLOYER = 0.8; // % employer contribution
export const ESTONIA_UNEMPLOYMENT_EMPLOYEE = 1.6; // % withheld from employee
export const ESTONIA_FUNDED_PENSION_II = 2; // % second pillar (employee)

// VAT registration threshold
export const ESTONIA_VAT_REGISTRATION_THRESHOLD_EUR = 40_000;

// Monthly deadlines
export const ESTONIA_TSD_DEADLINE_DAY = 10; // 10th of following month
export const ESTONIA_KMD_DEADLINE_DAY = 20; // 20th of following month

// EMTA X-tee service identifiers (machine-to-machine)
export const EMTA_XTEE_SERVICES = {
  KMD_UPLOAD: 'EE/GOV/70000349/mkrliides/uploadMime/v1',
  KMD_DOWNLOAD: 'EE/GOV/70000349/mkrliides/downloadMime/v1',
  TSD_UPLOAD: 'EE/GOV/70000349/mkrliides/uploadMime/v1',
  TSD_CONFIRM: 'EE/GOV/70000349/tsd/confirmTsd',
  TSD_STATUS: 'EE/GOV/70000349/tsd/getTsdStatus',
  TSD_FEEDBACK: 'EE/GOV/70000349/tsd/getTsdFeedback',
  OSS_DECLARATION: 'EE/GOV/70000349/oss/OssDeclaration/v1',
} as const;

export const ESTONIA_TAX_QUEUE_NAMES = {
  VAT_FILING: 'estonia-vat-filing',
  TSD_FILING: 'estonia-tsd-filing',
  TAX_REMINDER: 'estonia-tax-reminder',
} as const;
