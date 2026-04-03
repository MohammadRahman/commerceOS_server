/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/api/src/modules/bookkeeping/automation.controller.ts

import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RbacGuard } from '@app/common/guards';
import { InboxParserService } from './services/inbox-parser.service';
import { BankStatementService } from './services/bank-statement.service';
import { OpenBankingService } from './services/open-banking.service';
import { SupplierService } from './services/supplier.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutomationLog } from './entities/automation-log.entity';
import { AutomationConfig } from './entities/automation-config.entity';
import { UpdateAutomationConfigDto } from './dto/automation.dto';
import { OrgId, RequirePerm, UserId } from '@app/common';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('bookkeeping/automation')
export class AutomationController {
  constructor(
    private readonly inboxParser: InboxParserService,
    private readonly bankStatement: BankStatementService,
    private readonly openBanking: OpenBankingService,
    private readonly supplierService: SupplierService,
    @InjectRepository(AutomationLog)
    private readonly logRepo: Repository<AutomationLog>,
    @InjectRepository(AutomationConfig)
    private readonly configRepo: Repository<AutomationConfig>,
  ) {}

  // ── Config ─────────────────────────────────────────────────────────────────

  @Get('config')
  @RequirePerm('bookkeeping:read')
  async getConfig(@OrgId() orgId: string) {
    let cfg = await this.configRepo.findOne({ where: { orgId } });
    if (!cfg) {
      cfg = await this.configRepo.save(this.configRepo.create({ orgId }));
    }
    return this.sanitizeConfig(orgId, cfg);
  }

  @Patch('config')
  @RequirePerm('bookkeeping:write')
  async updateConfig(
    @OrgId() orgId: string,
    @Body() dto: UpdateAutomationConfigDto,
  ) {
    // FIX: decimal entity columns (emailAutoConfirmBelow, autoConfirmConfidence)
    // are typed as `string` in the entity but the DTO accepts `number` from the
    // client. TypeORM's upsert generic rejects a plain number for a string column.
    // Explicitly cast decimal fields to string before the upsert.
    const payload: Record<string, unknown> = { orgId, ...dto };
    if (typeof payload['emailAutoConfirmBelow'] === 'number') {
      payload['emailAutoConfirmBelow'] = String(
        payload['emailAutoConfirmBelow'],
      );
    }
    if (typeof payload['autoConfirmConfidence'] === 'number') {
      payload['autoConfirmConfidence'] = String(
        payload['autoConfirmConfidence'],
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.configRepo.upsert(payload as any, ['orgId']);
    const updated = await this.configRepo.findOneOrFail({ where: { orgId } });
    return this.sanitizeConfig(orgId, updated);
  }

  // ── Email / Inbox channel ──────────────────────────────────────────────────

  @Post('email/sync')
  @RequirePerm('bookkeeping:write')
  async syncEmail(@OrgId() orgId: string) {
    return this.inboxParser.syncInbox(orgId);
  }

  @Post('email/connect')
  @RequirePerm('bookkeeping:write')
  async connectEmail(
    @OrgId() orgId: string,
    @Body()
    body: { provider: 'gmail' | 'outlook'; code: string; redirectUri: string },
  ) {
    await this.configRepo.update(
      { orgId },
      { emailProvider: body.provider, emailEnabled: true },
    );
    return { ok: true };
  }

  @Post('email/disconnect')
  @RequirePerm('bookkeeping:write')
  async disconnectEmail(@OrgId() orgId: string) {
    // FIX: TypeORM update() generic rejects null for columns whose TS type is
    // `string` (select:false columns lose `| null` in TypeORM's inference).
    // The DB columns are nullable — cast payload to bypass the type constraint.
    await this.configRepo.update({ orgId }, {
      emailEnabled: false,
      emailAccessToken: null,
      emailRefreshToken: null,
      emailProvider: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    return { ok: true };
  }

  // ── Bank statement upload ──────────────────────────────────────────────────

  @Post('bank-statement/upload')
  @RequirePerm('bookkeeping:write')
  @UseInterceptors(FileInterceptor('statement'))
  async uploadBankStatement(
    @OrgId() orgId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF files are accepted');
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('File too large (max 10 MB)');
    }
    const base64 = file.buffer.toString('base64');
    return this.bankStatement.processUpload(orgId, base64, file.originalname);
  }

  // ── Open banking (PSD2) ────────────────────────────────────────────────────

  @Post('open-banking/auth-url')
  @RequirePerm('bookkeeping:write')
  async getOpenBankingAuthUrl(
    @OrgId() orgId: string,
    @Body() body: { bank: string; redirectUri: string },
  ) {
    return this.openBanking.getAuthUrl(orgId, body.bank, body.redirectUri);
  }

  @Post('open-banking/callback')
  @RequirePerm('bookkeeping:write')
  async openBankingCallback(
    @OrgId() orgId: string,
    @Body() body: { code: string; provider: string; redirectUri: string },
  ) {
    await this.openBanking.exchangeCode(
      orgId,
      body.code,
      body.provider,
      body.redirectUri,
    );
    return { ok: true };
  }

  @Post('open-banking/sync')
  @RequirePerm('bookkeeping:write')
  async syncOpenBanking(@OrgId() orgId: string) {
    return this.openBanking.syncTransactions(orgId);
  }

  @Get('open-banking/account')
  @RequirePerm('bookkeeping:read')
  async getAccountSummary(@OrgId() orgId: string) {
    return this.openBanking.getAccountSummary(orgId);
  }

  @Post('open-banking/disconnect')
  @RequirePerm('bookkeeping:write')
  async disconnectOpenBanking(@OrgId() orgId: string) {
    await this.configRepo.update({ orgId }, {
      openBankingEnabled: false,
      openBankingAccessToken: null,
      openBankingRefreshToken: null,
      openBankingAccountId: null,
      openBankingLastSync: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    return { ok: true };
  }

  // ── Review queue ───────────────────────────────────────────────────────────

  @Get('queue')
  @RequirePerm('bookkeeping:read')
  async getReviewQueue(
    @OrgId() orgId: string,
    @Query('status') status?: string,
    @Query('sourceType') sourceType?: string,
    @Query('limit') limit = '50',
  ) {
    const parsedLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);

    const qb = this.logRepo
      .createQueryBuilder('log')
      .where('log.orgId = :orgId', { orgId })
      .orderBy('log.createdAt', 'DESC')
      .take(parsedLimit);

    if (status) qb.andWhere('log.status = :status', { status });
    if (sourceType) qb.andWhere('log.sourceType = :sourceType', { sourceType });

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  @Patch('queue/:id/confirm')
  @RequirePerm('bookkeeping:write')
  async confirmItem(
    @OrgId() orgId: string,
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.updateLogStatus(id, orgId, 'confirmed', userId);
  }

  @Patch('queue/:id/reject')
  @RequirePerm('bookkeeping:write')
  async rejectItem(
    @OrgId() orgId: string,
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.updateLogStatus(id, orgId, 'rejected', userId);
  }

  @Post('queue/bulk-review')
  @RequirePerm('bookkeeping:write')
  async bulkReview(
    @OrgId() orgId: string,
    @UserId() userId: string,
    @Body() body: { ids: string[]; action: 'confirm' | 'reject' },
  ) {
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      throw new BadRequestException('ids must be a non-empty array');
    }
    if (body.ids.length > 100) {
      throw new BadRequestException('Maximum 100 items per bulk operation');
    }

    const status = body.action === 'confirm' ? 'confirmed' : 'rejected';
    const results = await Promise.allSettled(
      body.ids.map((id) => this.updateLogStatus(id, orgId, status, userId)),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    return { processed: succeeded, failed: results.length - succeeded };
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  @Get('stats')
  @RequirePerm('bookkeeping:read')
  async getStats(@OrgId() orgId: string) {
    const [pending, confirmed, rejected, total, suppliers] = await Promise.all([
      this.logRepo.count({ where: { orgId, status: 'pending' } }),
      this.logRepo.count({ where: { orgId, status: 'confirmed' } }),
      this.logRepo.count({ where: { orgId, status: 'rejected' } }),
      this.logRepo.count({ where: { orgId } }),
      this.supplierService.findAll(orgId),
    ]);
    return {
      pending,
      confirmed,
      rejected,
      total,
      supplierCount: suppliers.length,
    };
  }

  // ── Suppliers ──────────────────────────────────────────────────────────────

  @Get('suppliers')
  @RequirePerm('bookkeeping:read')
  async getSuppliers(@OrgId() orgId: string, @Query('q') q?: string) {
    return q
      ? this.supplierService.search(orgId, q)
      : this.supplierService.findAll(orgId);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async updateLogStatus(
    id: string,
    orgId: string,
    status: 'confirmed' | 'rejected',
    reviewedBy: string,
  ): Promise<AutomationLog> {
    const log = await this.logRepo.findOneOrFail({ where: { id, orgId } });
    log.status = status;
    log.reviewedBy = reviewedBy;
    log.reviewedAt = new Date();
    return this.logRepo.save(log);
  }

  private async sanitizeConfig(
    orgId: string,
    cfg: AutomationConfig,
  ): Promise<Record<string, unknown>> {
    // select:false columns are never present on a regular findOne result —
    // run a targeted addSelect query just to check presence as booleans.
    const withTokens = await this.configRepo
      .createQueryBuilder('ac')
      .addSelect('ac.emailAccessToken')
      .addSelect('ac.openBankingAccessToken')
      .where('ac.orgId = :orgId', { orgId })
      .getOne();

    const {
      emailAccessToken: _eat,
      emailRefreshToken: _ert,
      openBankingAccessToken: _obat,
      openBankingRefreshToken: _obrt,
      ...safe
    } = cfg as AutomationConfig & {
      emailAccessToken?: string;
      emailRefreshToken?: string;
      openBankingAccessToken?: string;
      openBankingRefreshToken?: string;
    };

    return {
      ...safe,
      emailConnected: !!withTokens?.emailAccessToken,
      openBankingConnected: !!withTokens?.openBankingAccessToken,
    };
  }
}
