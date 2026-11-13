import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

if (!process.env.MIGRATION_DATABASE_URL) {
  throw new Error('MIGRATION_DATABASE_URL must be set to the administrative connection before running integration migrations.');
}

const pool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
try {
  await pool.query('CREATE SCHEMA IF NOT EXISTS crm_integrations');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.integration_service_migrations (
      name TEXT PRIMARY KEY,
      "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const migrationDirectory = new URL('../db/migrations/', import.meta.url);
  const names = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of names) {
    const applied = await pool.query(
      'SELECT 1 FROM public.integration_service_migrations WHERE name = $1',
      [name],
    );
    if (applied.rowCount) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(await readFile(new URL(name, migrationDirectory), 'utf8'));
      await client.query(
        'INSERT INTO public.integration_service_migrations (name) VALUES ($1)',
        [name],
      );
      await client.query('COMMIT');
      console.info(`Applied integration-service migration ${name}`);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the migration error.
      }
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
