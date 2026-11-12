import pg from 'pg';

// platform-service connects as the database admin: it reads across every agency (the agency list,
// counts) and owns the platform staff tables, which the agency services' user cannot touch.
// Its own login (password + authenticator code) is what guards that reach.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10_000,
});

// A dropped idle connection must not crash the service; the pool replaces it.
pool.on('error', () => {});

export default pool;
