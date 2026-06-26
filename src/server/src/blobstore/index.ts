import { config } from '../config';
import { BlobStore } from './types';
import { FsBlobStore } from './fs';
import { S3BlobStore } from './s3';

export type { BlobStore } from './types';

let store: BlobStore | null = null;

// Ленивый синглтон стора. Драйвер выбирается один раз по config.blobStore.
export function getBlobStore(): BlobStore {
  if (!store) {
    store = config.blobStore === 's3' ? new S3BlobStore() : new FsBlobStore();
  }
  return store;
}
