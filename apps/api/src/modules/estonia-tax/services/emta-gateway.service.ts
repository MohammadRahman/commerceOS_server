// apps/api/src/modules/estonia-tax/services/emta-gateway.service.ts
// Submits XML declarations to EMTA via e-MTA upload endpoint.
// Production path: X-tee machine-to-machine (requires X-tee membership).
// Current implementation: e-MTA REST API (simpler to integrate, same result).

import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EstoniaTaxSubmission,
  SubmissionStatus,
  TaxFormType,
} from '../entities/estonia-tax.entities';

export interface EmtaSubmitResult {
  success: boolean;
  referenceNumber?: string;
  rawResponse: string;
  rejectionReason?: string;
}

@Injectable()
export class EstoniaEmtaGatewayService {
  private readonly logger = new Logger(EstoniaEmtaGatewayService.name);

  constructor(
    private readonly config: ConfigService,

    @InjectRepository(EstoniaTaxSubmission)
    private readonly submissionRepo: Repository<EstoniaTaxSubmission>,
  ) {}

  // ─── Submit to EMTA ───────────────────────────────────────────────────────
  // Sends the XML payload to EMTA's e-MTA upload endpoint.
  // The endpoint accepts KMD and TSD XML files via multipart POST.
  // Authentication: EMTA API key tied to the organization's e-MTA user.
  //
  // For X-tee: the same XML is wrapped in a SOAP envelope and sent via
  // the X-tee security server. The service identifier is stored in constants.

  async submitDeclaration(
    organizationId: string,
    formType: TaxFormType,
    taxYear: number,
    taxMonth: number,
    xmlPayload: string,
    submittedByUserId?: string,
    dryRun = false,
  ): Promise<EstoniaTaxSubmission> {
    // Always persist the submission record first (draft)
    const submission = this.submissionRepo.create({
      orgId: organizationId,
      formType,
      taxYear,
      taxMonth,
      status: SubmissionStatus.DRAFT,
      xmlPayload,
      submittedByUserId,
    });

    await this.submissionRepo.save(submission);

    if (dryRun) {
      this.logger.log(
        `[DRY RUN] ${formType} ${taxYear}/${taxMonth} — XML generated, not sent`,
      );
      return submission;
    }

    submission.status = SubmissionStatus.QUEUED;
    await this.submissionRepo.save(submission);

    try {
      const result = await this.sendToEmta(
        xmlPayload,
        formType,
        organizationId,
      );

      submission.status = result.success
        ? SubmissionStatus.ACCEPTED
        : SubmissionStatus.REJECTED;
      submission.emtaReferenceNumber = result.referenceNumber || '';
      submission.emtaResponse = result.rawResponse;
      submission.submittedAt = new Date();
      submission.rejectionReason = result.rejectionReason || '';

      if (result.success) {
        this.logger.log(
          `[EMTA] ${formType} ${taxYear}/${taxMonth} accepted. Ref: ${result.referenceNumber}`,
        );
      } else {
        this.logger.warn(
          `[EMTA] ${formType} ${taxYear}/${taxMonth} REJECTED: ${result.rejectionReason}`,
        );
      }
    } catch (err) {
      submission.status = SubmissionStatus.REJECTED;
      submission.rejectionReason = (err as Error).message;
      this.logger.error(`[EMTA] Submission failed`, err);
    }

    return this.submissionRepo.save(submission);
  }

  // ─── EMTA e-MTA REST upload ───────────────────────────────────────────────
  // Sends XML as a multipart file upload to EMTA's REST endpoint.
  // Auth: Bearer token derived from the organization's EMTA API credentials.
  //
  // IMPORTANT: Each organization must grant API access in their e-MTA portal:
  //   Settings → Access permissions → Grant access to third-party application
  // The access token returned there goes into EMTA_API_TOKEN env var.

  private async sendToEmta(
    xml: string,
    formType: TaxFormType,
    organizationId: string,
  ): Promise<EmtaSubmitResult> {
    const baseUrl = this.config.get<string>(
      'EMTA_API_BASE_URL',
      'https://e-mta.emta.ee',
    );
    const apiToken = this.config.get<string>(
      `EMTA_API_TOKEN_${organizationId}`,
    );

    if (!apiToken) {
      throw new InternalServerErrorException(
        `No EMTA API token configured for organization ${organizationId}. ` +
          'The organization owner must connect their e-MTA account.',
      );
    }

    const endpoint =
      formType === TaxFormType.KMD
        ? `${baseUrl}/api/v1/declarations/kmd`
        : `${baseUrl}/api/v1/declarations/tsd`;

    const formData = new FormData();
    formData.append(
      'declaration',
      new Blob([xml], { type: 'application/xml' }),
      `${formType}.xml`,
    );

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: 'application/json',
      },
      body: formData,
    });

    const rawResponse = await response.text();

    if (!response.ok) {
      return {
        success: false,
        rawResponse,
        rejectionReason: `HTTP ${response.status}: ${rawResponse}`,
      };
    }

    try {
      const json = JSON.parse(rawResponse);
      return {
        success: true,
        referenceNumber: json.referenceNumber ?? json.ref ?? json.id,
        rawResponse,
      };
    } catch {
      // EMTA sometimes returns plain text reference numbers
      return {
        success: true,
        referenceNumber: rawResponse.trim(),
        rawResponse,
      };
    }
  }

  // ─── Submission history ───────────────────────────────────────────────────

  async getSubmissions(
    organizationId: string,
    filters: { taxYear?: number; taxMonth?: number; formType?: TaxFormType },
  ): Promise<EstoniaTaxSubmission[]> {
    const where: any = { organizationId };
    if (filters.taxYear) where.taxYear = filters.taxYear;
    if (filters.taxMonth) where.taxMonth = filters.taxMonth;
    if (filters.formType) where.formType = filters.formType;

    return this.submissionRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: 50,
      select: [
        'id',
        'formType',
        'taxYear',
        'taxMonth',
        'status',
        'emtaReferenceNumber',
        'submittedAt',
        'rejectionReason',
        'submittedByUserId',
        'createdAt',
        // xmlPayload excluded from list — fetch individually if needed
      ],
    });
  }

  async getSubmissionXml(
    submissionId: string,
    organizationId: string,
  ): Promise<string> {
    const sub = await this.submissionRepo.findOneOrFail({
      where: { id: submissionId, orgId: organizationId },
      select: ['xmlPayload'],
    });
    return sub.xmlPayload;
  }
}
