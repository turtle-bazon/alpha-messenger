import { FastifyInstance } from 'fastify';
import { pool } from '../db';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  });
}
