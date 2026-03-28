// apps/api/src/modules/upload/upload.service.ts
import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import * as storageStrategyInterface from './storage-strategy.interface';

// ── Allowed types ─────────────────────────────────────────────────────────────

/** Allowed for payment screenshots and general small uploads */
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Extended set for store media — hero images, product photos, videos */
const STORE_MEDIA_MIME_TYPES = [
  ...IMAGE_MIME_TYPES,
  'image/avif',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime', // .mov
];

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB  — screenshots
const STORE_MEDIA_MAX_BYTES = 20 * 1024 * 1024; // 20MB — hero images + product photos
const VIDEO_MAX_BYTES = 50 * 1024 * 1024; // 50MB — hero videos

@Injectable()
export class UploadService {
  constructor(
    @Inject(storageStrategyInterface.STORAGE_STRATEGY)
    private strategy: storageStrategyInterface.StorageStrategy,
  ) {}

  // ── Generic upload ─────────────────────────────────────────────────────────

  async uploadFile(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    options?: storageStrategyInterface.UploadOptions,
  ): Promise<storageStrategyInterface.UploadResult> {
    const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
    if (buffer.byteLength > maxBytes) {
      throw new BadRequestException(
        `File too large. Max size is ${Math.round(maxBytes / 1024 / 1024)}MB`,
      );
    }

    const allowed = [...IMAGE_MIME_TYPES, 'application/pdf'];
    if (!allowed.includes(mimeType)) {
      throw new BadRequestException(
        `File type ${mimeType} not allowed. Allowed: ${allowed.join(', ')}`,
      );
    }

    return this.strategy.upload(buffer, originalName, options);
  }

  // ── Store media upload (hero images, hero videos, OG images) ──────────────

  async uploadStoreMedia(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    orgId: string,
    subfolder = 'media',
  ): Promise<storageStrategyInterface.UploadResult> {
    if (!STORE_MEDIA_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(
        `File type ${mimeType} not supported for store media. ` +
          `Supported: images (JPEG, PNG, WebP, GIF, AVIF) and videos (MP4, WebM, MOV)`,
      );
    }

    const isVideo = mimeType.startsWith('video/');
    const maxBytes = isVideo ? VIDEO_MAX_BYTES : STORE_MEDIA_MAX_BYTES;

    if (buffer.byteLength > maxBytes) {
      throw new BadRequestException(
        `File too large. Max size for ${isVideo ? 'videos' : 'images'} is ` +
          `${Math.round(maxBytes / 1024 / 1024)}MB`,
      );
    }

    return this.strategy.upload(buffer, originalName, {
      folder: `commerceos/${orgId}/${subfolder}`,
      publicId: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      maxBytes,
    });
  }

  // ── Payment screenshot ─────────────────────────────────────────────────────

  async uploadPaymentScreenshot(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    orgId: string,
    paymentLinkId: string,
  ): Promise<storageStrategyInterface.UploadResult> {
    if (!IMAGE_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(
        `Only images are accepted for payment screenshots`,
      );
    }

    return this.strategy.upload(buffer, originalName, {
      folder: `commerceos/${orgId}/payment-screenshots`,
      publicId: `${paymentLinkId}-${Date.now()}`,
      maxBytes: DEFAULT_MAX_BYTES,
    });
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async deleteFile(publicId: string): Promise<void> {
    return this.strategy.delete(publicId);
  }
}
// import { Injectable, Inject, BadRequestException } from '@nestjs/common';
// import * as storageStrategyInterface from './storage-strategy.interface';

// const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB default
// const ALLOWED_MIME_TYPES = [
//   'image/jpeg',
//   'image/png',
//   'image/webp',
//   'image/gif',
//   'application/pdf',
// ];

// @Injectable()
// export class UploadService {
//   constructor(
//     @Inject(storageStrategyInterface.STORAGE_STRATEGY)
//     private strategy: storageStrategyInterface.StorageStrategy,
//   ) {}

//   async uploadFile(
//     buffer: Buffer,
//     originalName: string,
//     mimeType: string,
//     options?: storageStrategyInterface.UploadOptions,
//   ): Promise<storageStrategyInterface.UploadResult> {
//     // Validate size
//     const maxBytes = options?.maxBytes ?? MAX_FILE_SIZE;
//     if (buffer.byteLength > maxBytes) {
//       throw new BadRequestException(
//         `File too large. Max size is ${Math.round(maxBytes / 1024 / 1024)}MB`,
//       );
//     }

//     // Validate mime type
//     if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
//       throw new BadRequestException(
//         `File type ${mimeType} not allowed. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
//       );
//     }

//     return this.strategy.upload(buffer, originalName, options);
//   }

//   async uploadPaymentScreenshot(
//     buffer: Buffer,
//     originalName: string,
//     mimeType: string,
//     orgId: string,
//     paymentLinkId: string,
//   ): Promise<storageStrategyInterface.UploadResult> {
//     return this.uploadFile(buffer, originalName, mimeType, {
//       folder: `commerceos/${orgId}/payment-screenshots`,
//       publicId: `${paymentLinkId}-${Date.now()}`,
//       maxBytes: 5 * 1024 * 1024, // 5MB
//     });
//   }

//   async deleteFile(publicId: string): Promise<void> {
//     return this.strategy.delete(publicId);
//   }
// }
