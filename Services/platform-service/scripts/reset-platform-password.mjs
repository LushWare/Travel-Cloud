// Gives a platform staff member a new password. Needs the server's .env (database access) AND a
// current code from that person's authenticator app, so neither alone is enough.
//   cd Services/platform-service && npm run reset-password
import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { verifyCode } from '../src/security/totp.js';
import { open } from '../src/security/secretBox.js';
import { generatePassword } from '../src/security/password.js';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Run this from Services/platform-service.');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 1,
  });
  try {
    const email = (await rl.question('Email of the console account: ')).trim().toLowerCase();
    const { rows } = await pool.query(
      `SELECT id, "totpSecret", "lastTotpStep" FROM crm_platform."PlatformUser" WHERE email = $1 AND "isActive" = true`,
      [email],
    );
    // Same message whether or not the account exists.
    const code = (await rl.question('6-digit code from that account\'s authenticator app: ')).trim();
    const user = rows[0];
    const step = user ? verifyCode(open(user.totpSecret), code, { lastUsedStep: Number(user.lastTotpStep) }) : null;
    if (step === null) throw new Error('Email or code is incorrect. Nothing was changed.');

    const password = generatePassword();
    const hash = await bcrypt.hash(password, 12);
    // All or nothing: a half-applied reset would leave a password nobody was ever shown.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE crm_platform."PlatformUser"
         SET "passwordHash" = $2, "mustChangePassword" = true, "lastTotpStep" = $3, "failedLoginCount" = 0, "lockedUntil" = NULL, "updatedAt" = NOW()
         WHERE id = $1`,
        [user.id, hash, step],
      );
      // A new password ends every existing console session for that person.
      await client.query(`UPDATE crm_platform."PlatformSession" SET "revokedAt" = NOW() WHERE "platformUserId" = $1 AND "revokedAt" IS NULL`, [user.id]);
      await client.query(
        `INSERT INTO crm_platform."AuditLog" ("actorId", "actorEmail", action, "targetType", "targetId", summary)
         VALUES ($1::text, $2, 'platform.password_reset', 'platform_user', $1::text, $3)`,
        [user.id, email, `Reset the console password for ${email} from the command line`],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    console.log('\nTemporary password (shown once):');
    console.log(`  ${password}`);
    console.log('Sign in at the console with it; you will then be asked to choose your own password.\n');
  } finally {
    rl.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exitCode = 1;
});
