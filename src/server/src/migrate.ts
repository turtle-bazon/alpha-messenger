import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pool } from './db';

// migrations/ sits next to src/ and dist/ (see Dockerfile: COPY migrations ./migrations)
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

// Arbitrary fixed advisory-lock key for migrations.
const MIGRATION_LOCK_KEY = 776655;

export async function runMigrations(): Promise<void> {
  if (!existsSync(MIGRATIONS_DIR)) return;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // Session-level advisory lock serializes concurrent runs (several test
  // files / server replicas may start migrations simultaneously).
  // The lock is taken and released on the same connection.
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const { rowCount } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1',
        [file],
      );
      if (rowCount) continue;

      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [
          file,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    client.release();
  }
}
