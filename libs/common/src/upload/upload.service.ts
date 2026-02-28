import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import * as storageStrategyInterface from './storage-strategy.interface';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB default
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
];

@Injectable()
export class UploadService {
  constructor(
    @Inject(storageStrategyInterface.STORAGE_STRATEGY)
    private strategy: storageStrategyInterface.StorageStrategy,
  ) {}

  async uploadFile(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    options?: storageStrategyInterface.UploadOptions,
  ): Promise<storageStrategyInterface.UploadResult> {
    // Validate size
    const maxBytes = options?.maxBytes ?? MAX_FILE_SIZE;
    if (buffer.byteLength > maxBytes) {
      throw new BadRequestException(
        `File too large. Max size is ${Math.round(maxBytes / 1024 / 1024)}MB`,
      );
    }

    // Validate mime type
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(
        `File type ${mimeType} not allowed. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    return this.strategy.upload(buffer, originalName, options);
  }

  async uploadPaymentScreenshot(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    orgId: string,
    paymentLinkId: string,
  ): Promise<storageStrategyInterface.UploadResult> {
    return this.uploadFile(buffer, originalName, mimeType, {
      folder: `commerceos/${orgId}/payment-screenshots`,
      publicId: `${paymentLinkId}-${Date.now()}`,
      maxBytes: 5 * 1024 * 1024, // 5MB
    });
  }

  async deleteFile(publicId: string): Promise<void> {
    return this.strategy.delete(publicId);
  }
}
