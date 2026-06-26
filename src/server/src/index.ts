import { buildApp } from './app';
import { config } from './config';
import { pool } from './db';
import { runMigrations } from './migrate';
import { getBlobStore } from './blobstore';
import { startEventListener } from './ws';

async function main(): Promise<void> {
  await runMigrations();
  // Подготовка хранилища блобов: каталог для fs, бакет (с ожиданием) для s3.
  await getBlobStore().init();

  const listener = startEventListener();
  const app = buildApp();
  await app.listen({ port: config.port, host: config.host });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await listener.end();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
