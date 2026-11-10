import pg from 'pg';
import { createTenantPool } from '../../../shared/tenancy/src/index.js';

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Every analytics query only sees the request's agency; see Services/shared/tenancy/src/sql.js.
export default createTenantPool(pool);
