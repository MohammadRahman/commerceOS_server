/* eslint-disable @typescript-eslint/prefer-promise-reject-errors */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import {
  StorageStrategy,
  UploadOptions,
  UploadResult,
} from './storage-strategy.interface';

@Injectable()
export class CloudinaryStrategy implements StorageStrategy {
  private readonly logger = new Logger(CloudinaryStrategy.name);

  constructor(private config: ConfigService) {
    cloudinary.config({
      cloud_name: this.config.get('CLOUDINARY_CLOUD_NAME'),
      api_key: this.config.get('CLOUDINARY_API_KEY'),
      api_secret: this.config.get('CLOUDINARY_API_SECRET'),
    });
  }

  async upload(
    buffer: Buffer,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const folder = options?.folder ?? 'commerceos';

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: options?.publicId,
          resource_type: 'auto',
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error || !result) {
            this.logger.error('Cloudinary upload failed', error);
            return reject(error ?? new Error('Upload failed'));
          }
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            bytes: result.bytes,
          });
        },
      );

      uploadStream.end(buffer);
    });
  }

  async delete(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId);
  }
}
