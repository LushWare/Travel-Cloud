/**
 * One Prisma client per service + a raw pg pool, all pointed at the SAME
 * database. Every service owns its own Postgres schema namespace (crm_users,
 * crm_leads, …) but they share one physical Postgres instance, so a single
 * connection string is correct for all of them — exactly how seed.mjs wires
 * its clients.
 *
 * Every client goes through the same agency filter the services use, so each
 * row the seed writes belongs to the agency it is seeding (runWithTenant).
 *
 * `requireDatabaseUrl` refuses to guess a database. A seed run against the
 * wrong Postgres cannot be undone, so an unset DATABASE_URL is a hard stop,
 * never a fallback.
 */
import pg from '../../analytics-service/node_modules/pg/lib/index.js';
import { PrismaClient as AuthClient } from '../../auth-service/node_modules/@prisma/client/index.js';
import { PrismaClient as UserClient, Prisma as UserPrisma } from '../../user-service/node_modules/@prisma/client/index.js';
import { PrismaClient as PkgClient, Prisma as PkgPrisma } from '../../package-service/node_modules/@prisma/client/index.js';
import { PrismaClient as LeadClient, Prisma as LeadPrisma } from '../../lead-service/node_modules/@prisma/client/index.js';
import { PrismaClient as BookClient, Prisma as BookPrisma } from '../../booking-service/node_modules/@prisma/client/index.js';
import { PrismaClient as BillClient, Prisma as BillPrisma } from '../../billing-service/node_modules/@prisma/client/index.js';
import { PrismaClient as CareerClient, Prisma as CareerPrisma } from '../../career-service/node_modules/@prisma/client/index.js';
import { PrismaClient as FlightClient, Prisma as FlightPrisma } from '../../flight-service/node_modules/@prisma/client/index.js';
import { PrismaClient as AssistantClient, Prisma as AssistantPrisma } from '../../assistant-service/node_modules/@prisma/client/index.js';
import { createTenantPrisma, getTenantId, isInTenantTransaction } from '../../shared/tenancy/src/index.js';
import { requireDatabaseUrl } from '../../database-url.mjs';

/**
 * Raw SQL inside an agency runs in a transaction that sets app.tenant_id, so inserts take the
 * agency from the column default. Outside an agency (reset, audit) it runs as the admin user.
 */
export function tenantAwareSql(pool) {
  return {
    async query(text, params) {
      const tenantId = getTenantId();
      if (!tenantId) return pool.query(text, params);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        const result = await client.query(text, params);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}

export const isConnectionClosed = (err) =>
  err?.code === 'P1017' || /Server has closed the connection/i.test(err?.message ?? '');

/**
 * The Supabase pooler sometimes drops a connection Prisma still holds; the next call on it fails
 * with P1017. Retry that call on a fresh connection. Calls inside a transaction are not retried.
 */
export function retryClosedConnections(client, { attempts = 3, delayMs = 1000 } = {}) {
  const wrapDelegate = (delegate) =>
    new Proxy(delegate, {
      get(target, op, receiver) {
        const fn = Reflect.get(target, op, receiver);
        if (typeof fn !== 'function') return fn;
        return async (...args) => {
          for (let attempt = 1; ; attempt += 1) {
            try {
              return await fn.apply(target, args);
            } catch (err) {
              if (!isConnectionClosed(err) || isInTenantTransaction() || attempt >= attempts) throw err;
              await new Promise((r) => setTimeout(r, delayMs * attempt));
            }
          }
        };
      },
    });
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      const isModel = typeof prop === 'string' && !prop.startsWith('$') && value && typeof value === 'object';
      return isModel ? wrapDelegate(value) : value;
    },
  });
}

export function connect(url = requireDatabaseUrl('seed-demo.mjs')) {
  const opts = { datasources: { db: { url } } };
  // pg is used only for the work Prisma's per-service clients are the wrong
  // tool for: cross-schema reset/delete by id prefix, and the post-run audit.
  const pool = new pg.Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 4,
    idleTimeoutMillis: 10_000,
  });
  // A dropped idle connection must not crash the run; the pool replaces it.
  pool.on('error', () => {});
  const scoped = (Client, Prisma) => retryClosedConnections(createTenantPrisma(new Client(opts), { Prisma }));
  return {
    url,
    sql: tenantAwareSql(pool),
    auth: retryClosedConnections(new AuthClient(opts)),
    users: scoped(UserClient, UserPrisma),
    pkg: scoped(PkgClient, PkgPrisma),
    lead: scoped(LeadClient, LeadPrisma),
    book: scoped(BookClient, BookPrisma),
    bill: scoped(BillClient, BillPrisma),
    career: scoped(CareerClient, CareerPrisma),
    flight: scoped(FlightClient, FlightPrisma),
    assistant: scoped(AssistantClient, AssistantPrisma),
  };
}

export async function disconnect(db) {
  await db.sql.end().catch(() => {});
  await Promise.all(
    ['auth', 'users', 'pkg', 'lead', 'book', 'bill', 'career', 'flight', 'assistant'].map((k) =>
      db[k].$disconnect().catch(() => {}),
    ),
  );
}
