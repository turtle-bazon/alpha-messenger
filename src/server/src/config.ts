import { resolve } from 'node:path';

const fsBlobDir =
  process.env.BLOB_FS_DIR ?? resolve(process.cwd(), 'blob-data');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://alpha:alpha@localhost:5432/alpha',

  // Хранилище блобов (крупных вложений). 'fs' — локальная content-addressed
  // ФС (дефолт для dev/тестов, нового сервиса не нужно), 's3' — объектный стор
  // (MinIO в prod/deploy). Выбор драйвера — см. blobstore/index.ts.
  blobStore: process.env.BLOB_STORE ?? 'fs',
  // Потолок размера одного блоба в байтах (сервер режет превышение на потоке).
  maxBlobSize: Number(process.env.MAX_BLOB_SIZE ?? 100 * 1024 * 1024),
  // Каталог fs-драйвера и каталог временных файлов загрузки (туда блоб льётся,
  // пока считается его хэш; затем атомарно финализируется). tmp держим внутри
  // корня, чтобы финализация была переименованием в пределах одной ФС.
  fsBlobDir,
  blobTmpDir: process.env.BLOB_TMP_DIR ?? resolve(fsBlobDir, '.tmp'),

  // Превью ссылок (#32): сервер сам тянет страницу/картинку (клиент не может —
  // CORS), поэтому строгие лимиты и SSRF-защита. allowPrivate разрешает фетч
  // приватных/loopback адресов — только для dev/тестов (фикстура на localhost).
  unfurl: {
    // геттер — читаем env живьём (тесты переключают флаг в рантайме)
    get allowPrivate(): boolean {
      return process.env.UNFURL_ALLOW_PRIVATE === '1';
    },
    timeoutMs: Number(process.env.UNFURL_TIMEOUT_MS ?? 5000),
    maxRedirects: Number(process.env.UNFURL_MAX_REDIRECTS ?? 4),
    maxHtmlBytes: Number(process.env.UNFURL_MAX_HTML_BYTES ?? 512 * 1024),
    maxImageBytes: Number(process.env.UNFURL_MAX_IMAGE_BYTES ?? 2 * 1024 * 1024),
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT, // напр. http://minio:9000
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'alpha-blobs',
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? '',
  },
};
