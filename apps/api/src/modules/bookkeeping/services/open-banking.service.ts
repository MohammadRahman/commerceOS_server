/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/modules/bookkeeping/services/open-banking.service.ts
//
// PSD2 Open Banking integration for Estonian banks.
// Primary: LHV Connect API
// Fallback: Nordigen / GoCardless (covers SEB, Swedbank, Luminor, Coop)
//
// Read-only AIS scope only — no payment initiation (PIS) ever requested.

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { EntryService } from './entry.service';
import { SupplierService } from './supplier.service';
import { AutomationLog } from '../entities/automation-log.entity';
import { AutomationConfig } from '../entities/automation-config.entity';
import { OpenBankingProvider } from '../entities/automation-config.entity';
import { EntryCategory } from '../entities/bookkeeping.entities';

// ── Local transaction type ─────────────────────────────────────────────────────
// FIX: BankTransaction was previously imported from bank-statement.service but
// that interface was removed when we consolidated around AiService types.
// Defined locally here — it's a simple normalised shape used only in this service.

interface NormalisedTransaction {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // negative = debit, positive = credit
  currency: string;
  counterpartyName?: string;
  counterpartyIban?: string;
  referenceNumber?: string;
  transactionId?: string;
}

// ── Public types ───────────────────────────────────────────────────────────────

export interface OpenBankingAuthUrl {
  url: string;
  state: string;
  provider: string;
}

export interface AccountSummary {
  accountId: string;
  iban: string;
  currency: string;
  holderName: string;
  balance: number;
  availableBalance: number;
  bankName: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class OpenBankingService {
  private readonly logger = new Logger(OpenBankingService.name);

  private readonly LHV_BASE = 'https://connect.lhv.eu/api/v1';
  private readonly NORDIGEN_BASE =
    'https://bankaccountdata.gocardless.com/api/v2';

  private readonly NORDIGEN_INSTITUTIONS: Record<string, string> = {
    seb: 'SEB_EEUHEE2X',
    swedbank: 'SWEDBANK_HABAEE2X',
    luminor: 'LUMINOR_NDEAEE2X',
    coop: 'COOP_EKRDEE22',
  };

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly entryService: EntryService,
    private readonly supplierService: SupplierService,
    @InjectRepository(AutomationLog)
    private readonly logRepo: Repository<AutomationLog>,
    @InjectRepository(AutomationConfig)
    private readonly configRepo: Repository<AutomationConfig>,
  ) {}

  // ── OAuth initiation ───────────────────────────────────────────────────────

  async getAuthUrl(
    organizationId: string,
    bank: string,
    redirectUri: string,
  ): Promise<OpenBankingAuthUrl> {
    const state = `${organizationId}:${bank}:${Date.now()}`;
    if (bank === 'lhv') return this.getLhvAuthUrl(state, redirectUri);
    return this.getNordigenAuthUrl(bank, state, redirectUri);
  }

  private getLhvAuthUrl(
    state: string,
    redirectUri: string,
  ): OpenBankingAuthUrl {
    const clientId = this.config.getOrThrow('LHV_CONNECT_CLIENT_ID');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'accounts transactions',
      state,
    });
    return {
      url: `${this.LHV_BASE}/oauth/authorize?${params}`,
      state,
      provider: 'lhv_connect',
    };
  }

  private async getNordigenAuthUrl(
    bank: string,
    state: string,
    redirectUri: string,
  ): Promise<OpenBankingAuthUrl> {
    const institutionId = this.NORDIGEN_INSTITUTIONS[bank];
    if (!institutionId) throw new Error(`Unknown bank: ${bank}`);

    const nordigenToken = await this.getNordigenToken();
    const res = await firstValueFrom(
      this.http.post(
        `${this.NORDIGEN_BASE}/requisitions/`,
        {
          redirect: redirectUri,
          institution_id: institutionId,
          reference: state,
          user_language: 'ET',
          account_selection: false,
        },
        { headers: { Authorization: `Bearer ${nordigenToken}` } },
      ),
    );
    return { url: res.data.link, state, provider: 'nordigen' };
  }

  // ── Token exchange ─────────────────────────────────────────────────────────

  async exchangeCode(
    organizationId: string,
    code: string,
    provider: string,
    redirectUri: string,
  ): Promise<void> {
    let accessToken: string, refreshToken: string, accountId: string;

    if (provider === 'lhv_connect') {
      const tokens = await this.exchangeLhvCode(code, redirectUri);
      accessToken = tokens.access;
      refreshToken = tokens.refresh;
      accountId = tokens.accountId;
    } else {
      const tokens = await this.exchangeNordigenRequisition(code);
      accessToken = tokens.access;
      refreshToken = tokens.refresh;
      accountId = tokens.accountId;
    }

    await this.configRepo.update(
      { orgId: organizationId },
      {
        openBankingEnabled: true,
        // FIX: cast to the proper OpenBankingProvider union type
        openBankingProvider: provider as OpenBankingProvider,
        openBankingAccessToken: accessToken,
        openBankingRefreshToken: refreshToken,
        openBankingAccountId: accountId,
      },
    );
  }

  private async exchangeLhvCode(code: string, redirectUri: string) {
    const clientId = this.config.getOrThrow('LHV_CONNECT_CLIENT_ID');
    const clientSecret = this.config.getOrThrow('LHV_CONNECT_CLIENT_SECRET');
    const res = await firstValueFrom(
      this.http.post(`${this.LHV_BASE}/oauth/token`, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    );
    return {
      access: res.data.access_token as string,
      refresh: res.data.refresh_token as string,
      accountId: (res.data.account_id as string) ?? '',
    };
  }

  private async exchangeNordigenRequisition(requisitionId: string) {
    const nordigenToken = await this.getNordigenToken();
    const res = await firstValueFrom(
      this.http.get(`${this.NORDIGEN_BASE}/requisitions/${requisitionId}/`, {
        headers: { Authorization: `Bearer ${nordigenToken}` },
      }),
    );
    const accountId = (res.data.accounts?.[0] as string) ?? '';
    return { access: nordigenToken, refresh: '', accountId };
  }

  // ── Sync transactions ──────────────────────────────────────────────────────

  async syncTransactions(
    organizationId: string,
  ): Promise<{ created: number; errors: number }> {
    // FIX: openBankingAccessToken has select:false — must addSelect explicitly
    const cfg = await this.configRepo
      .createQueryBuilder('ac')
      .addSelect('ac.openBankingAccessToken')
      .addSelect('ac.openBankingRefreshToken')
      .where('ac.orgId = :orgId', { orgId: organizationId })
      .getOne();

    if (!cfg?.openBankingEnabled || !cfg.openBankingAccessToken) {
      return { created: 0, errors: 0 };
    }

    const dateFrom = cfg.openBankingLastSync
      ? cfg.openBankingLastSync.toISOString().split('T')[0]
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0];

    let transactions: NormalisedTransaction[] = [];
    try {
      transactions =
        cfg.openBankingProvider === 'lhv_connect'
          ? await this.fetchLhvTransactions(cfg, dateFrom)
          : await this.fetchNordigenTransactions(cfg, dateFrom);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[OpenBanking] Fetch failed for org=${organizationId}: ${msg}`,
      );
      return { created: 0, errors: 1 };
    }

    let created = 0;
    for (const tx of transactions) {
      try {
        const log = await this.processTransaction(organizationId, tx, cfg);
        if (log) created++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[OpenBanking] TX error: ${msg}`);
      }
    }

    await this.configRepo.update(
      { orgId: organizationId },
      { openBankingLastSync: new Date() },
    );

    return { created, errors: 0 };
  }

  // ── LHV Connect API ────────────────────────────────────────────────────────

  private async fetchLhvTransactions(
    cfg: AutomationConfig,
    dateFrom: string,
  ): Promise<NormalisedTransaction[]> {
    const res = await firstValueFrom(
      this.http.get(
        `${this.LHV_BASE}/accounts/${cfg.openBankingAccountId}/transactions`,
        {
          params: { dateFrom, dateTo: new Date().toISOString().split('T')[0] },
          headers: { Authorization: `Bearer ${cfg.openBankingAccessToken}` },
        },
      ),
    );

    return (res.data?.transactions?.booked ?? []).map(
      (t: any): NormalisedTransaction => ({
        date: t.bookingDate ?? t.valueDate,
        description:
          t.remittanceInformationUnstructured ?? t.additionalInformation ?? '',
        amount: parseFloat(t.transactionAmount?.amount ?? '0'),
        currency: t.transactionAmount?.currency ?? 'EUR',
        counterpartyName: t.creditorName ?? t.debtorName ?? undefined,
        counterpartyIban:
          t.creditorAccount?.iban ?? t.debtorAccount?.iban ?? undefined,
        transactionId: t.transactionId ?? t.internalTransactionId ?? undefined,
      }),
    );
  }

  // ── Nordigen / GoCardless API ──────────────────────────────────────────────

  private async fetchNordigenTransactions(
    cfg: AutomationConfig,
    dateFrom: string,
  ): Promise<NormalisedTransaction[]> {
    const token = await this.getNordigenToken();
    const res = await firstValueFrom(
      this.http.get(
        `${this.NORDIGEN_BASE}/accounts/${cfg.openBankingAccountId}/transactions/`,
        {
          params: { date_from: dateFrom },
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
    );

    return (res.data?.transactions?.booked ?? []).map(
      (t: any): NormalisedTransaction => ({
        date: t.bookingDate,
        description: t.remittanceInformationUnstructured ?? '',
        amount: parseFloat(t.transactionAmount?.amount ?? '0'),
        currency: t.transactionAmount?.currency ?? 'EUR',
        counterpartyName: t.creditorName ?? t.debtorName ?? undefined,
        counterpartyIban:
          t.creditorAccount?.iban ?? t.debtorAccount?.iban ?? undefined,
        transactionId: t.transactionId ?? undefined,
      }),
    );
  }

  private async getNordigenToken(): Promise<string> {
    const secretId = this.config.getOrThrow('NORDIGEN_SECRET_ID');
    const secretKey = this.config.getOrThrow('NORDIGEN_SECRET_KEY');
    const res = await firstValueFrom(
      this.http.post(`${this.NORDIGEN_BASE}/token/new/`, {
        secret_id: secretId,
        secret_key: secretKey,
      }),
    );
    return res.data.access as string;
  }

  // ── Transaction → BookkeepingEntry + AutomationLog ────────────────────────

  private async processTransaction(
    organizationId: string,
    tx: NormalisedTransaction,
    cfg: AutomationConfig,
  ): Promise<AutomationLog | null> {
    // Dedup by bank transaction ID
    if (tx.transactionId) {
      const exists = await this.logRepo.findOne({
        where: {
          orgId: organizationId,
          externalRef: `ob:${tx.transactionId}`,
        },
      });
      if (exists) return null;
    }

    const isExpense = tx.amount < 0;
    const absAmount = Math.abs(tx.amount);

    let supplierId: string | undefined;
    let supplierName: string | undefined;
    let defaultCategory: string | undefined;

    if (isExpense && (tx.counterpartyName || tx.counterpartyIban)) {
      const { supplier } = await this.supplierService.findOrCreate(
        organizationId,
        { name: tx.counterpartyName ?? 'Unknown', iban: tx.counterpartyIban },
        'open_banking',
      );
      supplierId = supplier.id;
      supplierName = supplier.name;
      defaultCategory = supplier.defaultCategory ?? undefined;
    }

    // Bank data is clean — baseline confidence is higher than PDF parsing
    const confidence = 0.85;

    // FIX: autoConfirmConfidence is a string decimal — parseFloat before compare
    const autoConfirmThreshold = parseFloat(
      cfg.autoConfirmConfidence ?? '0.90',
    );
    const autoConfirm = confidence >= autoConfirmThreshold;

    const category = this.resolveCategory(
      defaultCategory,
      tx.description,
      tx.counterpartyName,
      isExpense,
    );

    // Write the actual BookkeepingEntry so it lands in the books immediately
    if (isExpense) {
      await this.entryService.addExpense(organizationId, {
        date: tx.date,
        grossAmount: absAmount,
        category: category as EntryCategory,
        description:
          tx.description ||
          `Payment to ${supplierName ?? tx.counterpartyName ?? 'unknown'}`,
        vatRate: 0,
        counterpartyName: tx.counterpartyName ?? supplierName,
        notes:
          [
            tx.counterpartyIban ? `IBAN: ${tx.counterpartyIban}` : '',
            tx.referenceNumber ? `Ref: ${tx.referenceNumber}` : '',
          ]
            .filter(Boolean)
            .join(' | ') || undefined,
      });
    } else {
      await this.entryService.addIncome(organizationId, {
        date: tx.date,
        grossAmount: absAmount,
        category: EntryCategory.OTHER_INCOME,
        description:
          tx.description ||
          `Bank credit${tx.counterpartyName ? ` from ${tx.counterpartyName}` : ''}`,
        vatRate: 0,
        counterpartyName: tx.counterpartyName,
        notes: tx.referenceNumber ? `Ref: ${tx.referenceNumber}` : undefined,
      });
    }

    // Audit log
    const log = this.logRepo.create({
      orgId: organizationId,
      sourceType: 'open_banking',
      status: autoConfirm ? 'confirmed' : 'pending',
      externalRef: tx.transactionId ? `ob:${tx.transactionId}` : null,
      supplierId: supplierId ?? null,
      // FIX: confidence is string in entity
      confidence: confidence as unknown as string,
      rawPayload: {
        counterpartyIban: tx.counterpartyIban,
        referenceNumber: tx.referenceNumber,
        provider: cfg.openBankingProvider,
      },
      parsedData: {
        type: isExpense ? 'expense' : 'income',
        amount: absAmount,
        currency: tx.currency,
        date: tx.date,
        description:
          tx.description ||
          (isExpense ? `Payment to ${supplierName}` : 'Bank credit'),
        category,
        supplierId,
        supplierName,
        confidence,
      },
    } as Partial<AutomationLog>);

    return this.logRepo.save(log);
  }

  // ── Category heuristic ────────────────────────────────────────────────────

  private resolveCategory(
    supplierDefault: string | undefined,
    description: string,
    counterpartyName: string | undefined,
    isExpense: boolean,
  ): string {
    if (supplierDefault) return supplierDefault;
    const text = `${description} ${counterpartyName ?? ''}`.toLowerCase();
    if (/fuel|petrol|kütu|neste|circle k|olerex/.test(text))
      return EntryCategory.TRANSPORT;
    if (/tele2|elisa|telia|phone|internet/.test(text))
      return EntryCategory.SOFTWARE;
    if (/rent|üür/.test(text)) return EntryCategory.RENT;
    if (/salary|palk|töötasu/.test(text)) return EntryCategory.STAFF_SALARY;
    if (/emta|maksuamet|tax|maks/.test(text))
      return EntryCategory.OTHER_EXPENSE;
    if (/eesti energia|enefit|elekter/.test(text))
      return EntryCategory.UTILITIES;
    if (/bolt food|wolt|glovo|food|toit/.test(text))
      return EntryCategory.SUPPLIER_FOOD;
    if (/marketing|ads|google|facebook|meta/.test(text))
      return EntryCategory.MARKETING;
    return isExpense ? EntryCategory.OTHER_EXPENSE : EntryCategory.OTHER_INCOME;
  }

  // ── Account info ───────────────────────────────────────────────────────────

  async getAccountSummary(
    organizationId: string,
  ): Promise<AccountSummary | null> {
    // FIX: addSelect the token column explicitly
    const cfg = await this.configRepo
      .createQueryBuilder('ac')
      .addSelect('ac.openBankingAccessToken')
      .where('ac.orgId = :orgId', { orgId: organizationId })
      .getOne();

    if (!cfg?.openBankingEnabled || !cfg.openBankingAccessToken) return null;

    try {
      if (cfg.openBankingProvider === 'lhv_connect') {
        const res = await firstValueFrom(
          this.http.get(
            `${this.LHV_BASE}/accounts/${cfg.openBankingAccountId}/balances`,
            {
              headers: {
                Authorization: `Bearer ${cfg.openBankingAccessToken}`,
              },
            },
          ),
        );
        const bal = res.data?.balances?.[0];
        return {
          accountId: cfg.openBankingAccountId ?? '',
          iban: res.data.iban ?? '',
          currency: 'EUR',
          holderName: res.data.ownerName ?? '',
          balance: parseFloat(bal?.balanceAmount?.amount ?? '0'),
          availableBalance: parseFloat(bal?.balanceAmount?.amount ?? '0'),
          bankName: 'LHV Pank',
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[OpenBanking] Balance fetch failed: ${msg}`);
    }
    return null;
  }
}
