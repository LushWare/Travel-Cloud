// Creates a Lushware platform admin for the console. There is no sign-up page for platform staff:
// accounts are only ever made here, by someone with the database and the service's .env.
//   cd Services/platform-service && npm run create-admin
//
// Prints a generated password and an authenticator setup key once, then asks for a 6-digit code
// from the app to prove the phone is set up before the account is saved.
import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { generateSecret, otpauthUri, verifyCode } from '../src/security/totp.js';
import { loadKey, seal } from '../src/security/secretBox.js';
import { generatePassword } from '../src/security/password.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const grouped = (secret) => secret.match(/.{1,4}/g).join(' ');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Run `npm run init-env` first.');
  loadKey();

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 1,
  });
  try {
    const exists = await pool.query(`SELECT to_regclass('crm_platform."PlatformUser"') AS t`);
    if (!exists.rows[0].t) throw new Error('The platform staff table does not exist yet. Run `node migrate-all.mjs` in Services first.');

    const email = (await rl.question('Email: ')).trim().toLowerCase();
    if (!EMAIL.test(email)) throw new Error('That is not a valid email address.');
    const taken = await pool.query(`SELECT 1 FROM crm_platform."PlatformUser" WHERE email = $1`, [email]);
    if (taken.rowCount) throw new Error('A platform staff account with that email already exists.');
    const name = (await rl.question('Full name: ')).trim().slice(0, 120);
    if (!name) throw new Error('A name is required.');

    const secret = generateSecret();
    console.log('\nAdd this account to your authenticator app (Google or Microsoft Authenticator):');
    console.log('  Choose "Enter a setup key", account name: Lush Console, key:');
    console.log(`  ${grouped(secret)}`);
    console.log(`  (or open this link on the phone: ${otpauthUri({ secret, account: email })})\n`);

    let step = null;
    for (let attempt = 1; attempt <= 3 && step === null; attempt += 1) {
      const code = (await rl.question('Enter the 6-digit code the app shows: ')).trim();
      step = verifyCode(secret, code);
      if (step === null) console.log('That code did not match. Check the key and the phone clock, then try again.');
    }
    if (step === null) throw new Error('Authenticator not confirmed; nothing was saved.');

    const password = generatePassword();
    await pool.query(
      `INSERT INTO crm_platform."PlatformUser" (email, name, "passwordHash", "mustChangePassword", role, "totpSecret", "lastTotpStep")
       VALUES ($1, $2, $3, true, 'platform_admin', $4, $5)`,
      [email, name, await bcrypt.hash(password, 12), seal(secret), step],
    );
    await pool.query(
      `INSERT INTO crm_platform."AuditLog" (action, "targetType", summary)
       VALUES ('platform.staff_created', 'platform_user', $1)`,
      [`Created platform admin ${email} from the command line`],
    );

    console.log('\nPlatform admin created. Temporary password (shown once):');
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
