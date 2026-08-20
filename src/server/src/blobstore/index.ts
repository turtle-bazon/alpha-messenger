import { config } from '../config';
import { BlobStore } from './types';
import { FsBlobStore } from './fs';
import { S3BlobStore } from './s3';

export type { BlobStore } from './types';

let store: BlobStore | null = null;

// Lazy store singleton. The driver is chosen once based on config.blobStore.
export function getBlobStore(): BlobStore {
  if (!store) {
    store = config.blobStore === 's3' ? new S3BlobStore() : new FsBlobStore();
  }
  return store;
}
