import pg from 'pg';
import { requireTenantId } from '../../shared/tenancy/src/context.js';
import logger from './config/logger.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const tenantDb = {
  async resolveFacebookPage(pageId) {
    const result = await pool.query(
      'SELECT "tenantId", "integrationId" FROM crm_integrations.resolve_facebook_page($1)',
      [pageId],
    );
    return result.rows[0] || null;
  },
  async query(text, params = []) {
    return tenantDb.transaction((db) => db.query(text, params));
  },
  async transaction(callback) {
    const tenantId = requireTenantId();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await callback({ query: (text, params = []) => client.query(text, params) });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error({
          tenantId,
          rollbackCode: rollbackError?.code,
          rollbackError: rollbackError?.message,
        }, 'Database transaction rollback failed');
      }
      throw error;
    } finally {
      client.release();
    }
  },
};
