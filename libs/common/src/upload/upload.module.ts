import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { STORAGE_STRATEGY } from './storage-strategy.interface';
import { CloudinaryStrategy } from './cloudinary.strategy';
import { S3Strategy } from './s3.strategy';
import { UploadService } from './upload.service';

@Module({
  imports: [ConfigModule],
  providers: [
    CloudinaryStrategy,
    S3Strategy,
    {
      // Factory: pick strategy based on STORAGE_PROVIDER env var
      // STORAGE_PROVIDER=cloudinary (default) | s3 | gcloud
      provide: STORAGE_STRATEGY,
      inject: [ConfigService, CloudinaryStrategy, S3Strategy],
      useFactory: (
        config: ConfigService,
        cloudinary: CloudinaryStrategy,
        s3: S3Strategy,
      ) => {
        const provider = config.get<string>('STORAGE_PROVIDER') ?? 'cloudinary';
        switch (provider) {
          case 's3':
            return s3;
          case 'cloudinary':
          default:
            return cloudinary;
        }
      },
    },
    UploadService,
  ],
  exports: [UploadService],
})
export class UploadModule {}
