import { resolve } from 'node:path';

const fsBlobDir =
  process.env.BLOB_FS_DIR ?? resolve(process.cwd(), 'blob-data');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://alpha:alpha@localhost:5432/alpha',

  // Blob storage (large attachments). 'fs' — local content-addressed
  // filesystem (default for dev/tests, no extra service needed), 's3' — object
  // store (MinIO in prod/deploy). Driver selection — see blobstore/index.ts.
  blobStore: process.env.BLOB_STORE ?? 'fs',
  // Max size of a single blob in bytes (the server cuts off excess on the stream).
  maxBlobSize: Number(process.env.MAX_BLOB_SIZE ?? 100 * 1024 * 1024),
  // fs driver directory and upload temp directory (the blob streams there while
  // its hash is computed; then finalized atomically). tmp lives inside the root
  // so finalization is a rename within one filesystem.
  fsBlobDir,
  blobTmpDir: process.env.BLOB_TMP_DIR ?? resolve(fsBlobDir, '.tmp'),

  // Link previews (#32): the server fetches pages/images itself (the client can't —
  // CORS), hence strict limits and SSRF protection. allowPrivate allows fetching
  // private/loopback addresses — dev/tests only (fixture on localhost).
  unfurl: {
    // getter — read env live (tests flip the flag at runtime)
    get allowPrivate(): boolean {
      return process.env.UNFURL_ALLOW_PRIVATE === '1';
    },
    timeoutMs: Number(process.env.UNFURL_TIMEOUT_MS ?? 5000),
    maxRedirects: Number(process.env.UNFURL_MAX_REDIRECTS ?? 4),
    maxHtmlBytes: Number(process.env.UNFURL_MAX_HTML_BYTES ?? 512 * 1024),
    maxImageBytes: Number(process.env.UNFURL_MAX_IMAGE_BYTES ?? 2 * 1024 * 1024),
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT, // e.g. http://minio:9000
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'alpha-blobs',
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? '',
  },

  // Tenor GIF API (free plan, client_key = app name).
  tenorApiKey: process.env.TENOR_API_KEY ?? '',
};
