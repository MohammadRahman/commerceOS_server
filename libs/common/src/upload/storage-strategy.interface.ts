export interface UploadResult {
  url: string;
  publicId: string;
  format?: string;
  bytes?: number;
}

export interface UploadOptions {
  folder?: string;
  publicId?: string;
  maxBytes?: number;
}

export interface StorageStrategy {
  upload(
    buffer: Buffer,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult>;

  delete(publicId: string): Promise<void>;
}

export const STORAGE_STRATEGY = Symbol('STORAGE_STRATEGY');
