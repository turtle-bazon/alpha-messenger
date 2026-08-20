import { Readable } from 'node:stream';

// Store of opaque blobs addressed by content-hash (sha256 hex).
// The server does not interpret contents: it only puts by key and serves by key.
export interface BlobStore {
  // Driver setup: directory for fs, bucket for s3. Idempotent.
  init(): Promise<void>;
  // Whether a blob with this id exists (for dedup — never overwrite an existing one).
  has(id: string): Promise<boolean>;
  // Finalizes an already staged temp file under key id. Implementations may
  // take over (move) srcPath; after the call it may no longer exist.
  putFile(id: string, srcPath: string, size: number): Promise<void>;
  // Content stream, or null if the blob doesn't exist.
  get(id: string): Promise<Readable | null>;
}
