/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  StorageStrategy,
  UploadOptions,
  UploadResult,
} from './storage-strategy.interface';

/**
 * AWS S3 strategy — activate by setting STORAGE_PROVIDER=s3 in .env
 * Requires: @aws-sdk/client-s3, @aws-sdk/lib-storage
 * npm install @aws-sdk/client-s3 @aws-sdk/lib-storage -w apps/api
 */
@Injectable()
export class S3Strategy implements StorageStrategy {
  private readonly logger = new Logger(S3Strategy.name);

  constructor(private config: ConfigService) {}

  async upload(
    buffer: Buffer,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    // Lazy-load to avoid hard dependency
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

    const client = new S3Client({
      region: this.config.get('AWS_REGION') ?? 'us-east-1',
      credentials: {
        accessKeyId: this.config.get('AWS_ACCESS_KEY_ID') ?? '',
        secretAccessKey: this.config.get('AWS_SECRET_ACCESS_KEY') ?? '',
      },
    });

    const bucket = this.config.get('AWS_S3_BUCKET') ?? '';
    const folder = options?.folder ?? 'commerceos';
    const key = `${folder}/${options?.publicId ?? filename}`;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: this.getContentType(filename),
      }),
    );

    const region = this.config.get('AWS_REGION') ?? 'us-east-1';
    const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

    return { url, publicId: key };
  }

  async delete(publicId: string): Promise<void> {
    const { S3Client, DeleteObjectCommand } =
      await import('@aws-sdk/client-s3');

    const client = new S3Client({
      region: this.config.get('AWS_REGION') ?? 'us-east-1',
      credentials: {
        accessKeyId: this.config.get('AWS_ACCESS_KEY_ID') ?? '',
        secretAccessKey: this.config.get('AWS_SECRET_ACCESS_KEY') ?? '',
      },
    });

    await client.send(
      new DeleteObjectCommand({
        Bucket: this.config.get('AWS_S3_BUCKET') ?? '',
        Key: publicId,
      }),
    );
  }

  private getContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      pdf: 'application/pdf',
    };
    return types[ext ?? ''] ?? 'application/octet-stream';
  }
}
